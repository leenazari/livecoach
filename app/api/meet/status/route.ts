import { NextRequest, NextResponse } from "next/server";
import { currentRecallBotState } from "@/lib/recall-bot-status";
import { resolveRecordScope } from "@/lib/record-scope";
import { validUuid } from "@/lib/shared-meet-capture";
import { supabaseService } from "@/lib/supabase";
import { validMeetSessionId } from "@/lib/transcriber";

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
    .eq("status", "active");
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

export async function GET(req: NextRequest) {
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

    const subscription = subscriptions?.[0];
    if (!subscription) {
      return NextResponse.json(
        { error: "No notetaker request exists for this call" },
        {
          status: 404,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    const { data: capture, error: captureError } = await supabaseService
      .from("meet_bots")
      .select("id,bot_id,bot_name,status,ended_at")
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
          botName: capture.bot_name || "LiveCoach Notetaker",
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

    return NextResponse.json(
      {
        botName: capture.bot_name || "LiveCoach Notetaker",
        localStatus: state.terminal ? "left" : capture.status,
        state,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unable to check the notetaker status" },
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }
}
