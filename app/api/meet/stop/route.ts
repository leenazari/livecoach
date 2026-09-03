// FIRST LINE MARKER (route): app/api/meet/stop/route.ts  — exports POST, no JSX
import { NextRequest, NextResponse } from "next/server";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";
import { validMeetSessionId } from "@/lib/transcriber";

// Stop a Meet bot. Accepts EITHER { botId } (direct) or { sessionId } (look up
// the active bot(s) for that session). The session path means "End session"
// can stop the bot even after the tab that started it is gone.
export async function POST(req: NextRequest) {
  try {
    const accountScope = await resolveRecordScope();
    const { botId, sessionId } = await req.json();

    const requestedBotId =
      typeof botId === "string" && botId.length <= 200 ? botId : null;
    const requestedSessionId = validMeetSessionId(sessionId) ? sessionId : null;
    if (!requestedBotId && !requestedSessionId) {
      return NextResponse.json(
        { error: "An owned bot or LiveCoach session is required" },
        { status: 400 }
      );
    }

    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION;
    if (!key || !region) {
      return NextResponse.json(
        { error: "RECALL_API_KEY / RECALL_REGION not set in Vercel env" },
        { status: 500 }
      );
    }

    // Never call Recall with a browser-supplied bot id directly. First resolve
    // the user's private subscription, then the canonical capture behind it.
    let subscriptionsQuery = supabaseService
      .from("meet_capture_subscribers")
      .select("id,capture_id,session_id,status")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId);
    if (requestedSessionId) {
      subscriptionsQuery = subscriptionsQuery.eq(
        "session_id",
        requestedSessionId
      );
    }
    const { data: subscriptions, error: subscriptionsError } =
      await subscriptionsQuery;
    if (subscriptionsError) {
      return NextResponse.json(
        { error: subscriptionsError.message },
        { status: 500 }
      );
    }
    const captureIds = Array.from(
      new Set((subscriptions || []).map((row: any) => String(row.capture_id)))
    );
    if (!captureIds.length) {
      // Nothing active to stop - treat as success so the UI stays clean.
      return NextResponse.json({ ok: true, detached: 0, stopped: 0 });
    }

    const { data: captures, error: capturesError } = await supabaseService
      .from("meet_bots")
      .select("id,bot_id")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("status", "active")
      .in("id", captureIds);
    if (capturesError) {
      return NextResponse.json({ error: capturesError.message }, { status: 500 });
    }
    const selectedCaptures = requestedBotId
      ? (captures || []).filter((capture: any) => capture.bot_id === requestedBotId)
      : captures || [];
    const selectedCaptureIds = new Set(
      selectedCaptures.map((capture: any) => String(capture.id))
    );
    const selectedSubscriptions = (subscriptions || []).filter((row: any) =>
      selectedCaptureIds.has(String(row.capture_id))
    );
    if (!selectedSubscriptions.length) {
      return NextResponse.json({ ok: true, detached: 0, stopped: 0 });
    }

    const endedAt = new Date().toISOString();
    const activeSelectedSubscriptions = selectedSubscriptions.filter(
      (subscription: any) => subscription.status === "active"
    );
    for (const subscription of activeSelectedSubscriptions) {
      const { error: endError } = await supabaseService
        .from("meet_capture_subscribers")
        .update({ status: "ended", ended_at: endedAt, updated_at: endedAt })
        .eq("workspace_id", accountScope.workspaceId)
        .eq("owner_id", accountScope.userId)
        .eq("id", subscription.id)
        .eq("status", "active");
      if (endError) throw endError;

      const { error: tokenError } = await supabaseService
        .from("meet_stream_tokens")
        .update({ revoked_at: endedAt, updated_at: endedAt })
        .eq("workspace_id", accountScope.workspaceId)
        .eq("owner_id", accountScope.userId)
        .eq("session_id", subscription.session_id)
        .is("revoked_at", null);
      if (tokenError) throw tokenError;
    }

    const leave = async (id: string) => {
      const endpoint = `https://${region}.recall.ai/api/v1/bot/${encodeURIComponent(
        id
      )}/leave_call/`;
      const call = (auth: string) =>
        fetch(endpoint, {
          method: "POST",
          headers: { Authorization: auth, Accept: "application/json" },
        });
      let res = await call(key);
      if (res.status === 401 || res.status === 403) res = await call(`Token ${key}`);
      return res.ok;
    };

    let stopped = 0;
    let remainingSubscribers = 0;
    for (const capture of selectedCaptures) {
      const { count, error: countError } = await supabaseService
        .from("meet_capture_subscribers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", accountScope.workspaceId)
        .eq("capture_id", capture.id)
        .eq("status", "active");
      if (countError) throw countError;
      if ((count || 0) > 0) {
        remainingSubscribers += count || 0;
        continue;
      }
      const ok = await leave(capture.bot_id);
      if (!ok) continue;
      stopped += 1;
      const { error: updateError } = await supabaseService
        .from("meet_bots")
        .update({ status: "left", ended_at: endedAt })
        .eq("workspace_id", accountScope.workspaceId)
        .eq("id", capture.id)
        .eq("status", "active");
      if (updateError) throw updateError;
    }

    return NextResponse.json(
      {
        ok: true,
        detached: activeSelectedSubscriptions.length,
        stopped,
        remainingSubscribers,
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
