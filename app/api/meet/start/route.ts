// FIRST LINE MARKER (route): app/api/meet/start/route.ts  — exports POST, no JSX
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { privateRecordFields, resolveRecordScope } from "@/lib/record-scope";
import { currentRecallBotState } from "@/lib/recall-bot-status";
import { supabaseAdmin } from "@/lib/supabase";
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
  bot_id: string;
  bot_name: string | null;
  session_id: string;
};

async function reconcileRecallBotState(
  bots: ActiveBotRow[],
  workspaceId: string,
  ownerId: string,
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
        const { error } = await supabaseAdmin
          .from("meet_bots")
          .update({ status: "left", ended_at: endedAt })
          .eq("workspace_id", workspaceId)
          .eq("owner_id", ownerId)
          .eq("bot_id", bot.bot_id)
          .eq("status", "active");
        if (error) throw error;
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
      const { error } = await supabaseAdmin
        .from("meet_bots")
        .update({ status: "left", ended_at: endedAt })
        .eq("workspace_id", workspaceId)
        .eq("owner_id", ownerId)
        .eq("bot_id", bot.bot_id)
        .eq("status", "active");
      if (error) throw error;
      await supabaseAdmin
        .from("meet_stream_tokens")
        .update({ revoked_at: endedAt, updated_at: endedAt })
        .eq("workspace_id", workspaceId)
        .eq("owner_id", ownerId)
        .eq("session_id", bot.session_id)
        .is("revoked_at", null);
    } catch (error) {
      console.error("Could not reconcile Recall bot state", error);
      active.push(bot);
    }
  }
  return active;
}

export async function POST(req: NextRequest) {
  try {
    const accountScope = await resolveRecordScope();
    const { meetingUrl, sessionId } = await req.json();
    if (!validMeetingUrl(meetingUrl) || !validMeetSessionId(sessionId)) {
      return NextResponse.json(
        { error: "A supported meeting link and LiveCoach session are required" },
        { status: 400 }
      );
    }

    const identity = await getTranscriberIdentity(accountScope.userId);
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - TRANSCRIBER_HARD_LIMIT_SECONDS * 1000
    );
    // Provider-side automatic leave already enforces this ceiling. Reconcile
    // any old row left active by a lost browser or historic webhook so it
    // cannot block a later call forever.
    const { error: staleBotError } = await supabaseAdmin
      .from("meet_bots")
      .update({ status: "left", ended_at: now.toISOString() })
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("status", "active")
      .lt("created_at", staleBefore.toISOString());
    if (staleBotError) throw staleBotError;

    const { data: activeBotRows, error: existingError } = await supabaseAdmin
      .from("meet_bots")
      .select("bot_id,bot_name,session_id")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("status", "active")
      .gte("created_at", staleBefore.toISOString())
      .limit(2);
    if (existingError) throw existingError;
    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION;
    const activeBots =
      activeBotRows?.length && key && region
        ? await reconcileRecallBotState(
            activeBotRows as ActiveBotRow[],
            accountScope.workspaceId,
            accountScope.userId,
            region,
            key
          )
        : (activeBotRows || []);
    const existing = activeBots.find(
      (bot: any) => bot.session_id === sessionId
    );
    if (existing?.bot_id) {
      return NextResponse.json(
        {
          botId: existing.bot_id,
          botName: existing.bot_name || identity.botName,
          status: "already_active",
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (activeBots.length) {
      return NextResponse.json(
        {
          error:
            "Your notetaker is already active on another call. End that call before starting a new one.",
          code: "transcriber_already_active",
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
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

    const endpoint = `https://${region}.recall.ai/api/v1/bot/`;
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
      bot_name: identity.botName,
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

    const data = JSON.parse(raw);
    if (!data?.id || typeof data.id !== "string") {
      throw new Error("Recall returned a bot without an identifier");
    }

    // A bot without a scoped database record cannot be stopped safely and its
    // transcript cannot be assigned safely. Remove it immediately on failure.
    const { error: botInsertError } = await supabaseAdmin
      .from("meet_bots")
      .insert({
        session_id: String(sessionId),
        bot_id: data.id,
        bot_name: identity.botName,
        provider: "recall",
        webhook_token_hash: webhookTokenHash,
        webhook_token_expires_at: webhookTokenExpiresAt.toISOString(),
        status: "active",
        ...privateRecordFields(accountScope),
      });
    if (botInsertError) {
      await leaveUntrackedBot(region, key, data.id);
      if (botInsertError.code === "23505") {
        return NextResponse.json(
          {
            error:
              "Your notetaker is already active on another call. End that call before starting a new one.",
            code: "transcriber_already_active",
          },
          { status: 409, headers: { "Cache-Control": "private, no-store" } }
        );
      }
      throw botInsertError;
    }

    return NextResponse.json(
      {
        botId: data.id,
        botName: identity.botName,
        status: "joining",
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
