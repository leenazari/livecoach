// FIRST LINE MARKER (route): app/api/meet/start/route.ts  — exports POST, no JSX
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { privateRecordFields, resolveRecordScope } from "@/lib/record-scope";
import { currentRecallBotState } from "@/lib/recall-bot-status";
import {
  meetingInstanceKey,
  meetingUrlsMatch,
  shareableCalendarSource,
  validUuid,
} from "@/lib/shared-meet-capture";
import {
  grantSharedCaptureAccess,
  resolveSharedCalendarOccurrence,
  type SharedCalendarOccurrence,
  type SharedUpcomingCall,
} from "@/lib/shared-call-access";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import {
  getTranscriberIdentity,
  validMeetingUrl,
  validMeetSessionId,
} from "@/lib/transcriber";
import {
  calculateTranscriberUsage,
  londonDayBounds,
  normaliseDailyTranscriberLimit,
  TRANSCRIBER_DAILY_LIMIT_DEFAULT,
  TRANSCRIBER_HARD_LIMIT_SECONDS,
} from "@/lib/transcriber-usage";

// Public Railway worker that receives Recall's transcript webhooks.
// Override in Vercel env with MEET_WORKER_URL if the domain ever changes.
const WORKER_URL =
  (process.env.MEET_WORKER_URL ||
    "https://livecoach-meet-worker-production.up.railway.app").replace(
    /\/+$/,
    ""
  );

async function recallRequest(
  endpoint: string,
  key: string,
  init: Omit<RequestInit, "headers"> = {}
) {
  const call = (authorization: string) =>
    fetch(endpoint, {
      ...init,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  let response = await call(key);
  if (response.status === 401 || response.status === 403) {
    response = await call(`Token ${key}`);
  }
  return response;
}

async function leaveUntrackedBot(
  region: string,
  key: string,
  botId: string
) {
  try {
    await recallRequest(
      `https://${region}.recall.ai/api/v1/bot/${encodeURIComponent(
        botId
      )}/leave_call/`,
      key,
      { method: "POST" }
    );
  } catch (error) {
    console.error("Failed to remove untracked Recall bot", error);
  }
}

type ActiveBotRow = {
  id: string;
  bot_id: string;
  bot_name: string | null;
  session_id: string;
  owner_id: string;
  meeting_instance_key: string | null;
};

type ActiveSubscriptionRow = {
  id: string;
  capture_id: string;
  session_id: string;
  upcoming_id: string | null;
};

async function finishCapture(
  bot: ActiveBotRow,
  workspaceId: string,
  endedAt: string
) {
  const { data: subscribers, error: subscribersError } = await supabaseService
    .from("meet_capture_subscribers")
    .select("owner_id,session_id")
    .eq("workspace_id", workspaceId)
    .eq("capture_id", bot.id);
  if (subscribersError) throw subscribersError;

  const { error: botError } = await supabaseService
    .from("meet_bots")
    .update({ status: "left", ended_at: endedAt })
    .eq("workspace_id", workspaceId)
    .eq("id", bot.id)
    .eq("status", "active");
  if (botError) throw botError;

  const { error: subscriberError } = await supabaseService
    .from("meet_capture_subscribers")
    .update({ status: "ended", ended_at: endedAt, updated_at: endedAt })
    .eq("workspace_id", workspaceId)
    .eq("capture_id", bot.id)
    .eq("status", "active");
  if (subscriberError) throw subscriberError;

  for (const subscriber of subscribers || []) {
    const { error: tokenError } = await supabaseService
      .from("meet_stream_tokens")
      .update({ revoked_at: endedAt, updated_at: endedAt })
      .eq("workspace_id", workspaceId)
      .eq("owner_id", subscriber.owner_id)
      .eq("session_id", subscriber.session_id)
      .is("revoked_at", null);
    if (tokenError) throw tokenError;
  }
}

async function reconcileRecallBotState(
  bots: ActiveBotRow[],
  workspaceId: string,
  region: string,
  key: string
) {
  const active: ActiveBotRow[] = [];
  for (const bot of bots) {
    try {
      // This is one on-demand reconciliation when a person starts another
      // call, not background polling. It prevents a provider auto-leave from
      // leaving a stale database row that blocks the next meeting.
      const response = await recallRequest(
        `https://${region}.recall.ai/api/v1/bot/${encodeURIComponent(
          bot.bot_id
        )}/`,
        key,
        { signal: AbortSignal.timeout(5000) }
      );
      if (response.status === 404) {
        const endedAt = new Date().toISOString();
        await finishCapture(bot, workspaceId, endedAt);
        continue;
      }
      if (!response.ok) {
        active.push(bot);
        continue;
      }
      const providerState = currentRecallBotState(await response.json());
      if (!providerState.terminal) {
        active.push(bot);
        continue;
      }
      const endedAt = providerState.endedAt || new Date().toISOString();
      await finishCapture(bot, workspaceId, endedAt);
    } catch (error) {
      console.error("Could not reconcile Recall bot state", error);
      active.push(bot);
    }
  }
  return active;
}

async function attachSubscriber(input: {
  captureId: string;
  workspaceId: string;
  ownerId: string;
  sessionId: string;
  upcomingId: string;
}) {
  return supabaseService.from("meet_capture_subscribers").upsert(
    {
      capture_id: input.captureId,
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      session_id: input.sessionId,
      upcoming_id: input.upcomingId,
      status: "active",
      visibility: "private",
      ended_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,session_id" }
  );
}

export async function POST(req: NextRequest) {
  try {
    const accountScope = await resolveRecordScope();
    const { meetingUrl, sessionId, upcomingId } = await req.json();
    if (!validMeetingUrl(meetingUrl) || !validMeetSessionId(sessionId)) {
      return NextResponse.json(
        { error: "A supported meeting link and LiveCoach session are required" },
        { status: 400 }
      );
    }
    if (upcomingId != null && !validUuid(upcomingId)) {
      return NextResponse.json(
        { error: "The scheduled call reference is invalid" },
        { status: 400 }
      );
    }

    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION;
    if (!key) {
      return NextResponse.json(
        { error: "RECALL_API_KEY is not set in Vercel env" },
        { status: 500 }
      );
    }
    if (!region) {
      return NextResponse.json(
        { error: "RECALL_REGION is not set in Vercel env (e.g. us-west-2)" },
        { status: 500 }
      );
    }

    const identity = await getTranscriberIdentity(accountScope.userId);
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - TRANSCRIBER_HARD_LIMIT_SECONDS * 1000
    );

    let verifiedUpcomingId: string | null = null;
    let sharedInstanceKey: string | null = null;
    let sharedOccurrence: SharedCalendarOccurrence | null = null;
    if (upcomingId) {
      // A meeting URL alone never grants another person's transcript. RLS must
      // first prove that this exact synced occurrence belongs to this account.
      const { data: call, error: callError } = await supabaseAdmin
        .from("upcoming_calls")
        .select(
          "id,workspace_id,owner_id,company_id,workstream_id,title,scheduled_at,meeting_url,source,external_id,completed_at,attendees,intent,prepped,prep"
        )
        .eq("workspace_id", accountScope.workspaceId)
        .eq("owner_id", accountScope.userId)
        .eq("id", upcomingId)
        .maybeSingle();
      if (callError) throw callError;
      if (!call) {
        return NextResponse.json(
          { error: "This scheduled call is not available to this account" },
          { status: 403 }
        );
      }
      verifiedUpcomingId = call.id;
      if (
        !call.completed_at &&
        shareableCalendarSource(call.source, call.external_id) &&
        meetingUrlsMatch(call.meeting_url, meetingUrl)
      ) {
        sharedOccurrence = await resolveSharedCalendarOccurrence(
          call as SharedUpcomingCall
        );
        sharedInstanceKey =
          sharedOccurrence?.instanceKey ||
          meetingInstanceKey(call.meeting_url, call.scheduled_at);
      }
    }

    // Provider-side automatic leave already enforces this ceiling. Reconcile
    // any old capture left active by a lost browser or historic webhook so it
    // cannot block a teammate's private session forever.
    const { data: staleCaptureRows, error: staleBotError } = await supabaseService
      .from("meet_bots")
      .select(
        "id,bot_id,bot_name,session_id,owner_id,meeting_instance_key"
      )
      .eq("workspace_id", accountScope.workspaceId)
      .eq("status", "active")
      .lt("created_at", staleBefore.toISOString());
    if (staleBotError) throw staleBotError;
    for (const staleCapture of (staleCaptureRows || []) as ActiveBotRow[]) {
      await finishCapture(
        staleCapture,
        accountScope.workspaceId,
        now.toISOString()
      );
    }

    // Concurrency belongs to the user's private subscription, not the capture
    // owner. The first teammate may end while another remains on the same bot.
    const { data: subscriptionRows, error: subscriptionError } =
      await supabaseService
        .from("meet_capture_subscribers")
        .select("id,capture_id,session_id,upcoming_id")
        .eq("workspace_id", accountScope.workspaceId)
        .eq("owner_id", accountScope.userId)
        .eq("status", "active")
        .limit(2);
    if (subscriptionError) throw subscriptionError;
    const subscriptions = (subscriptionRows || []) as ActiveSubscriptionRow[];
    const captureIds = subscriptions.map((row) => row.capture_id);
    const { data: subscribedCaptureRows, error: subscribedCaptureError } =
      captureIds.length
        ? await supabaseService
            .from("meet_bots")
            .select(
              "id,bot_id,bot_name,session_id,owner_id,meeting_instance_key"
            )
            .eq("workspace_id", accountScope.workspaceId)
            .eq("status", "active")
            .in("id", captureIds)
        : { data: [], error: null };
    if (subscribedCaptureError) throw subscribedCaptureError;
    const activeSubscribedCaptures = await reconcileRecallBotState(
      (subscribedCaptureRows || []) as ActiveBotRow[],
      accountScope.workspaceId,
      region,
      key
    );
    const activeCaptureById = new Map(
      activeSubscribedCaptures.map((capture) => [capture.id, capture])
    );
    const activeSubscriptions = subscriptions.filter((subscription) =>
      activeCaptureById.has(subscription.capture_id)
    );
    const existingSubscription = activeSubscriptions.find(
      (subscription) => subscription.session_id === sessionId
    );
    if (existingSubscription) {
      const capture = activeCaptureById.get(existingSubscription.capture_id)!;
      return NextResponse.json(
        {
          botId: capture.bot_id,
          botName: capture.bot_name || identity.botName,
          status: "already_active",
          sharedCapture: Boolean(capture.meeting_instance_key),
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (activeSubscriptions.length) {
      return NextResponse.json(
        {
          error:
            "Your LiveCoach session is already active on another call. End that session before starting a new one.",
          code: "transcriber_already_active",
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Only an exact Google or Microsoft calendar occurrence can share an
    // existing capture. Ad hoc URLs remain private and create their own bot.
    if (sharedInstanceKey && verifiedUpcomingId) {
      const { data: matchingCaptureRows, error: matchingCaptureError } =
        await supabaseService
          .from("meet_bots")
          .select(
            "id,bot_id,bot_name,session_id,owner_id,meeting_instance_key"
          )
          .eq("workspace_id", accountScope.workspaceId)
          .eq("meeting_instance_key", sharedInstanceKey)
          .eq("status", "active")
          .limit(2);
      if (matchingCaptureError) throw matchingCaptureError;
      const matchingCaptures = await reconcileRecallBotState(
        (matchingCaptureRows || []) as ActiveBotRow[],
        accountScope.workspaceId,
        region,
        key
      );
      const sharedCapture = matchingCaptures[0];
      if (sharedCapture) {
        if (sharedOccurrence) {
          const { error: hostError } = await supabaseService
            .from("meet_bots")
            .update({
              host_owner_id: sharedOccurrence.hostOwnerId,
              canonical_upcoming_id: sharedOccurrence.canonical.id,
            })
            .eq("workspace_id", accountScope.workspaceId)
            .eq("id", sharedCapture.id);
          if (hostError) throw hostError;
          await grantSharedCaptureAccess({
            captureId: sharedCapture.id,
            occurrence: sharedOccurrence,
            captureOwnerId: sharedCapture.owner_id,
          });
        }
        const { error: attachError } = await attachSubscriber({
          captureId: sharedCapture.id,
          workspaceId: accountScope.workspaceId,
          ownerId: accountScope.userId,
          sessionId,
          upcomingId: verifiedUpcomingId,
        });
        if (attachError) {
          if (attachError.code === "23505") {
            return NextResponse.json(
              {
                error:
                  "Your LiveCoach session is already active on another call. End that session before starting a new one.",
                code: "transcriber_already_active",
              },
              { status: 409, headers: { "Cache-Control": "private, no-store" } }
            );
          }
          throw attachError;
        }
        return NextResponse.json(
          {
            botId: sharedCapture.bot_id,
            botName: sharedCapture.bot_name || "LiveCoach Notetaker",
            status: "shared_active",
            sharedCapture: true,
          },
          { headers: { "Cache-Control": "private, no-store" } }
        );
      }
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("workspace_members")
      .select("transcriber_daily_minutes_limit")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("user_id", accountScope.userId)
      .eq("status", "active")
      .single();
    if (membershipError) throw membershipError;
    const dailyLimitMinutes = normaliseDailyTranscriberLimit(
      membership?.transcriber_daily_minutes_limit ??
        TRANSCRIBER_DAILY_LIMIT_DEFAULT
    );
    const { start: dayStart, end: dayEnd } = londonDayBounds(now);
    const usageWindowStart = new Date(
      dayStart.getTime() - TRANSCRIBER_HARD_LIMIT_SECONDS * 1000
    );
    const { data: usageRows, error: usageError } = await supabaseAdmin
      .from("meet_bots")
      .select("owner_id,created_at,ended_at,status")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .gte("created_at", usageWindowStart.toISOString())
      .lt("created_at", dayEnd.toISOString());
    if (usageError) throw usageError;
    const usage = calculateTranscriberUsage(
      usageRows || [],
      accountScope.userId,
      dailyLimitMinutes,
      now
    );
    if (usage.remainingSeconds < 60) {
      return NextResponse.json(
        {
          error: `Today's ${dailyLimitMinutes} minute notetaker allowance has been used. The workspace owner can raise it in Team access.`,
          code: "transcriber_daily_limit_reached",
          usage,
        },
        { status: 429, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const botHardLimitSeconds = Math.min(
      TRANSCRIBER_HARD_LIMIT_SECONDS,
      usage.remainingSeconds
    );

    const endpoint = `https://${region}.recall.ai/api/v1/bot/`;
    const captureBotName = sharedInstanceKey
      ? "LiveCoach Notetaker"
      : identity.botName;
    const webhookToken = randomBytes(32).toString("base64url");
    const webhookTokenHash = createHash("sha256")
      .update(webhookToken)
      .digest("hex");
    const webhookTokenExpiresAt = new Date(
      Date.now() + 4 * 60 * 60 * 1000
    );
    const realtimeEndpoint = new URL(`${WORKER_URL}/webhook/recall`);
    realtimeEndpoint.searchParams.set("token", webhookToken);
    const body = {
      meeting_url: meetingUrl,
      bot_name: captureBotName,
      // Provider-side protection against abandoned bots. This runs inside
      // Recall, so it still works if the LiveCoach tab is closed, asleep or
      // offline. `everyone_left_timeout` handles the normal case. The two bot
      // heuristics cover calls where another notetaker remains behind, and the
      // five-minute silence timer is the final fallback. A three-hour hard
      // ceiling prevents an exceptional provider/platform state running on
      // indefinitely without cutting off ordinary calls or workshops.
      automatic_leave: {
        everyone_left_timeout: {
          timeout: 30,
          activate_after: 60,
        },
        bot_detection: {
          using_participant_names: {
            matches: [
              "notetaker",
              "note taker",
              "transcriber",
              "meeting recorder",
              "meeting assistant",
              "ai assistant",
              "copilot",
              "grain",
              "fellow",
              "tl;dv",
              "read.ai",
              "fathom",
              "otter",
              "fireflies",
              "avoma",
            ],
            activate_after: 300,
            timeout: 30,
          },
          // Recall notes that Google Meet participant events can be noisy, so
          // this fallback deliberately waits longer than name matching.
          using_participant_events: {
            activate_after: 600,
            timeout: 180,
          },
        },
        silence_detection: {
          // Keep this inside Recall so cost protection survives a sleeping or
          // closed browser. The in-app clock starts only after real speech, and
          // Recall's other waiting-room/no-participant guards cover pre-call time.
          activate_after: 60,
          timeout: 300,
        },
        waiting_room_timeout: Math.min(300, botHardLimitSeconds),
        noone_joined_timeout: Math.min(300, botHardLimitSeconds),
        in_call_not_recording_timeout: Math.min(300, botHardLimitSeconds),
        in_call_recording_timeout: botHardLimitSeconds,
        recording_permission_denied_timeout: 30,
      },
      // Recall returns this signed metadata on every webhook. The worker still
      // checks it against the canonical meet_bots row before relaying anything.
      metadata: {
        session_id: sessionId,
        owner_id: accountScope.userId,
        workspace_id: accountScope.workspaceId,
      },
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: "prioritize_low_latency",
              language_code: identity.languageCode,
            },
          },
        },
        // Per-bot realtime webhook -> our Railway worker.
        realtime_endpoints: [
          {
            type: "webhook",
            url: realtimeEndpoint.toString(),
            events: ["transcript.data"],
          },
        ],
      },
    };

    const res = await recallRequest(endpoint, key, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Recall create-bot failed (${res.status})`,
          detail: raw.slice(0, 600),
        },
        { status: 502 }
      );
    }

    const recallBot = JSON.parse(raw);
    if (!recallBot?.id || typeof recallBot.id !== "string") {
      throw new Error("Recall returned a bot without an identifier");
    }

    // A bot without a scoped database record cannot be stopped safely and its
    // transcript cannot be assigned safely. Remove it immediately on failure.
    const { data: insertedCapture, error: botInsertError } = await supabaseAdmin
      .from("meet_bots")
      .insert({
        session_id: String(sessionId),
        bot_id: recallBot.id,
        bot_name: captureBotName,
        provider: "recall",
        webhook_token_hash: webhookTokenHash,
        webhook_token_expires_at: webhookTokenExpiresAt.toISOString(),
        meeting_instance_key: sharedInstanceKey,
        source_upcoming_id: verifiedUpcomingId,
        host_owner_id: sharedOccurrence?.hostOwnerId || accountScope.userId,
        canonical_upcoming_id:
          sharedOccurrence?.canonical.id || verifiedUpcomingId,
        status: "active",
        ...privateRecordFields(accountScope),
      })
      .select("id")
      .single();
    if (botInsertError) {
      await leaveUntrackedBot(region, key, recallBot.id);
      if (botInsertError.code === "23505") {
        // Two teammates can press Start at almost the same instant. The unique
        // instance index chooses one capture. Remove this losing provider bot,
        // then attach this private session to the winner.
        if (sharedInstanceKey && verifiedUpcomingId) {
          const { data: winner } = await supabaseService
            .from("meet_bots")
            .select("id,bot_id,bot_name")
            .eq("workspace_id", accountScope.workspaceId)
            .eq("meeting_instance_key", sharedInstanceKey)
            .eq("status", "active")
            .maybeSingle();
          if (winner) {
            if (sharedOccurrence) {
              const { error: winnerHostError } = await supabaseService
                .from("meet_bots")
                .update({
                  host_owner_id: sharedOccurrence.hostOwnerId,
                  canonical_upcoming_id: sharedOccurrence.canonical.id,
                })
                .eq("workspace_id", accountScope.workspaceId)
                .eq("id", winner.id);
              if (winnerHostError) throw winnerHostError;
              await grantSharedCaptureAccess({
                captureId: winner.id,
                occurrence: sharedOccurrence,
                captureOwnerId: accountScope.userId,
              });
            }
            const { error: attachError } = await attachSubscriber({
              captureId: winner.id,
              workspaceId: accountScope.workspaceId,
              ownerId: accountScope.userId,
              sessionId,
              upcomingId: verifiedUpcomingId,
            });
            if (!attachError) {
              return NextResponse.json(
                {
                  botId: winner.bot_id,
                  botName: winner.bot_name || "LiveCoach Notetaker",
                  status: "shared_active",
                  sharedCapture: true,
                },
                { headers: { "Cache-Control": "private, no-store" } }
              );
            }
          }
        }
        return NextResponse.json(
          {
            error:
              "Your LiveCoach session is already active on another call. End that session before starting a new one.",
            code: "transcriber_already_active",
          },
          { status: 409, headers: { "Cache-Control": "private, no-store" } }
        );
      }
      throw botInsertError;
    }

    if (insertedCapture?.id && sharedOccurrence) {
      await grantSharedCaptureAccess({
        captureId: insertedCapture.id,
        occurrence: sharedOccurrence,
        captureOwnerId: accountScope.userId,
      });
    }

    return NextResponse.json(
      {
        botId: recallBot.id,
        botName: captureBotName,
        status: "joining",
        sharedCapture: Boolean(sharedInstanceKey),
        autoStop: {
          everyoneLeftSeconds: 30,
          silentFallbackMinutes: 5,
          hardLimitMinutes: Math.floor(botHardLimitSeconds / 60),
          dailyRemainingMinutes: usage.remainingMinutes,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}
