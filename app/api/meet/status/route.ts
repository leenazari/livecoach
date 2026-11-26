import { NextRequest, NextResponse } from "next/server";
import { currentRecallBotState } from "@/lib/recall-bot-status";
import { resolveRecordScope } from "@/lib/record-scope";
import { validUuid } from "@/lib/shared-meet-capture";
import { supabaseService } from "@/lib/supabase";
import { validMeetSessionId } from "@/lib/transcriber";
import { crmBlockerPayload } from "@/lib/crm-blocker";

async function recallRequest(endpoint: string, key: string) {
  const call = (authorization: string) =>
    fetch(endpoint, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  let response = await call(key);
  if (response.status === 401 || response.status === 403) {
    response = await call(`Token ${key}`);
  }
  return response;
}

async function finishCapture(input: {
  captureId: string;
  workspaceId: string;
  endedAt: string;
}) {
  const { data: subscribers, error: subscribersError } = await supabaseService
    .from("meet_capture_subscribers")
    .select("owner_id,session_id")
    .eq("workspace_id", input.workspaceId)
    .eq("capture_id", input.captureId);
  if (subscribersError) throw subscribersError;

  const { error: captureError } = await supabaseService
    .from("meet_bots")
    .update({ status: "left", ended_at: input.endedAt })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.captureId)
    .eq("status", "active");
  if (captureError) throw captureError;

  const { error: subscriptionError } = await supabaseService
    .from("meet_capture_subscribers")
    .update({
      status: "ended",
      ended_at: input.endedAt,
      updated_at: input.endedAt,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("capture_id", input.captureId)
    .in("status", ["scheduled", "active"]);
  if (subscriptionError) throw subscriptionError;

  for (const subscriber of subscribers || []) {
    const { error: tokenError } = await supabaseService
      .from("meet_stream_tokens")
      .update({ revoked_at: input.endedAt, updated_at: input.endedAt })
      .eq("workspace_id", input.workspaceId)
      .eq("owner_id", subscriber.owner_id)
      .eq("session_id", subscriber.session_id)
      .is("revoked_at", null);
    if (tokenError) throw tokenError;
  }
}

async function readStatus(req: NextRequest, resume = false) {
  try {
    const scope = await resolveRecordScope();
    const sessionId = String(req.nextUrl.searchParams.get("session") || "");
    const upcomingId = String(
      req.nextUrl.searchParams.get("upcoming") || ""
    ).trim();
    if (!validMeetSessionId(sessionId)) {
      return NextResponse.json(
        { error: "A valid LiveCoach session is required" },
        { status: 400 }
      );
    }
    if (upcomingId && !validUuid(upcomingId)) {
      return NextResponse.json(
        { error: "The scheduled call reference is invalid" },
        { status: 400 }
      );
    }

    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION;
    if (!key || !region) {
      return NextResponse.json(
        { error: "The notetaker provider is not configured" },
        { status: 503 }
      );
    }

    let subscriptionQuery = supabaseService
      .from("meet_capture_subscribers")
      .select("capture_id,session_id,upcoming_id,status,updated_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("session_id", sessionId)
      .order("updated_at", { ascending: false })
      .limit(1);
    let { data: subscriptions, error: subscriptionError } =
      await subscriptionQuery;
    if (subscriptionError) throw subscriptionError;

    // `upcoming` is a recovery path for an already-open call workspace whose
    // browser session was refreshed. It remains scoped to this exact account.
    if (!subscriptions?.length && upcomingId) {
      const recovery = await supabaseService
        .from("meet_capture_subscribers")
        .select("capture_id,session_id,upcoming_id,status,updated_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("upcoming_id", upcomingId)
        .order("updated_at", { ascending: false })
        .limit(1);
      subscriptions = recovery.data;
      subscriptionError = recovery.error;
      if (subscriptionError) throw subscriptionError;
    }

    let subscription = subscriptions?.[0];
    if (!subscription) {
      return NextResponse.json(
        { error: "No notetaker request exists for this call" },
        {
          status: 404,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    // Never use a valid room from another call merely because both belong to
    // this account. Only a missing room may recover through the exact event.
    if (upcomingId && subscription.upcoming_id !== upcomingId) {
      return NextResponse.json(
        { error: "The call room does not match this calendar event" },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const { data: capture, error: captureError } = await supabaseService
      .from("meet_bots")
      .select("id,bot_id,bot_name,status,ended_at,scheduled_join_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", subscription.capture_id)
      .maybeSingle();
    if (captureError) throw captureError;
    if (!capture) {
      return NextResponse.json(
        { error: "The notetaker request could not be found" },
        {
          status: 404,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }
    // Verify the occurrence even for an older tab with an exact legacy room.
    // Matching a calendar row alone must not resurrect its previous recording.
    if (upcomingId) {
      const { data: occurrence, error: occurrenceError } = await supabaseService.from("upcoming_calls")
        .select("scheduled_at")
        .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
        .eq("id", upcomingId).maybeSingle();
      if (occurrenceError) throw occurrenceError;
      const starts = Date.parse(occurrence?.scheduled_at || "");
      const ended = Date.parse(capture.ended_at || "");
      const reserved = Date.parse(capture.scheduled_join_at || "");
      if (!Number.isFinite(starts) ||
        (Number.isFinite(ended) && ended < starts - 15 * 60000) ||
        (Number.isFinite(reserved) && Math.abs(reserved - starts) > 15 * 60000)) {
        return NextResponse.json({ error: "That notetaker belongs to the earlier meeting time. Start this rescheduled call to use its own recording." },
          { status: 404, headers: { "Cache-Control": "private, no-store" } });
      }
    }
    // The same occurrence may have an older reservation room and a newer
    // timestamped room after a rollout. Reuse this user's already-active
    // subscription to this exact capture/event, never another user's room or
    // another meeting. Do not reactivate an explicitly ended subscription.
    const subscriptionUpcomingId = subscription.upcoming_id;
    const sameCaptureActiveSubscription = async () => {
      let query = supabaseService.from("meet_capture_subscribers")
        .select("capture_id,session_id,upcoming_id,status,updated_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("capture_id", capture.id)
        .eq("status", "active");
      query = subscriptionUpcomingId
        ? query.eq("upcoming_id", subscriptionUpcomingId)
        : query.is("upcoming_id", null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    };
    if (subscription.status === "scheduled") {
      subscription = await sameCaptureActiveSubscription() || subscription;
    }
    let identity = {
      botId: capture.bot_id,
      sessionId: subscription.session_id,
      upcomingId: subscription.upcoming_id,
      botName: capture.bot_name || "LiveCoach Notetaker",
    };

    const providerResponse = await recallRequest(
      `https://${region}.recall.ai/api/v1/bot/${encodeURIComponent(
        capture.bot_id
      )}/`,
      key
    );
    if (providerResponse.status === 404) {
      const endedAt = capture.ended_at || new Date().toISOString();
      if (capture.status === "active") {
        await finishCapture({
          captureId: capture.id,
          workspaceId: scope.workspaceId,
          endedAt,
        });
      }
      return NextResponse.json(
        {
          ...identity,
          canResume: false,
          localStatus: "left",
          state: {
            code: "not_found",
            subCode: "provider_record_missing",
            phase: "failed",
            message:
              "The provider no longer has this notetaker request. Retry the notetaker.",
            terminal: true,
            endedAt,
            changedAt: endedAt,
            joined: false,
            recording: false,
          },
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (!providerResponse.ok) {
      return NextResponse.json(
        { error: "The live notetaker status is temporarily unavailable" },
        {
          status: 502,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    const state = currentRecallBotState(await providerResponse.json());
    if (state.terminal && capture.status === "active") {
      await finishCapture({
        captureId: capture.id,
        workspaceId: scope.workspaceId,
        endedAt: state.endedAt || new Date().toISOString(),
      });
    }

    const canResume =
      capture.status === "active" &&
      !state.terminal &&
      ["scheduled", "active"].includes(subscription.status) &&
      ["joining", "waiting_room", "in_call_not_recording", "recording"].includes(state.phase);

    // Calendar reservations intentionally do not consume a user's live slot.
    // Opening the actual live workspace activates just that user's existing
    // stream subscription. No bot is created, restarted or moved here.
    if (resume && canResume && subscription.status === "scheduled") {
      const { data: activated, error: activateError } = await supabaseService
        .from("meet_capture_subscribers")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("session_id", subscription.session_id)
        .eq("capture_id", subscription.capture_id)
        .in("status", ["scheduled", "active"])
        .select("status")
        .maybeSingle();
      if (activateError?.code === "23505") {
        // Another tab can activate the old room after the lookup above. A
        // unique-index conflict is recoverable only for this same capture.
        const active = await sameCaptureActiveSubscription();
        if (!active) {
          return NextResponse.json(
            {
              ...crmBlockerPayload({
                code: "transcriber_already_active",
                title: "Live coaching is open for a different call",
                reason: "Your account already has a live coaching session for another meeting",
                nextAction: "End that call, then reopen this one. This meeting's notetaker keeps recording",
              }),
              code: "transcriber_already_active",
            },
            { status: 409, headers: { "Cache-Control": "private, no-store" } }
          );
        }
        identity = { ...identity, sessionId: active.session_id, upcomingId: active.upcoming_id };
      } else {
        if (activateError) throw activateError;
        if (!activated) {
          return NextResponse.json(
            { error: "This call session has ended. Reopen the call to view its saved transcript." },
            { status: 409, headers: { "Cache-Control": "private, no-store" } }
          );
        }
      }
    }

    return NextResponse.json(
      {
        ...identity,
        canResume,
        localStatus: state.terminal ? "left" : capture.status,
        state,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    const reference = crypto.randomUUID();
    const code = String(error?.code || "");
    console.error("live_coaching_recovery_failed", {
      reference,
      code: /^[A-Z0-9_]{1,32}$/.test(code) ? code : "request_failed",
    });
    return NextResponse.json(
      crmBlockerPayload({
        code: "live_coaching_recovery_failed",
        title: "Live coaching could not connect",
        reason: "The existing notetaker session could not be verified",
        nextAction: "Keep the meeting open while LiveCoach retries. If this continues, sign in again and reopen this call. Do not send another notetaker while its status is unclear",
        responsible: "system",
        reference,
      }),
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  return readStatus(req);
}

// POST is an explicit, idempotent attachment to an already scheduled capture.
// The separate /start endpoint remains the only cost-bearing dispatch path.
export async function POST(req: NextRequest) {
  return readStatus(req, true);
}
