import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { completeUpcomingForCall } from "@/lib/calls";
import { validMeetSessionId } from "@/lib/transcriber";
import {
  canonicalizeCallSummaryPayload,
  runCallSummaryJob,
  type CallSummaryPayload,
} from "@/lib/call-summary-jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

const forwardedHeaders = (req: NextRequest) => {
  const headers = new Headers({ "Content-Type": "application/json" });
  const cookie = req.headers.get("cookie");
  const authorization = req.headers.get("authorization");
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  return headers;
};

async function postSummaryFollowups(
  req: NextRequest,
  payload: CallSummaryPayload,
  summary: any
) {
  const origin = new URL(req.url).origin;
  const post = (path: string, body: Record<string, unknown>) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: forwardedHeaders(req),
      body: JSON.stringify(body),
    }).then((response) => {
      if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    });
  const work: Promise<unknown>[] = [];

  if (payload.companyId && summary) {
    work.push(
      post("/api/crm/update-profile", {
        companyId: payload.companyId,
        summary,
        sessionId: payload.sessionId,
        candidate: payload.candidate || null,
        role: payload.role || null,
      })
    );
  }
  if (payload.manualRecap && payload.companyId && payload.userNotes?.trim()) {
    work.push(
      post("/api/crm/extract-tasks", {
        companyId: payload.companyId,
        workstreamId: payload.workstreamId || null,
        text: payload.userNotes,
        clientName: payload.candidate || null,
        source: "recap",
      })
    );
  }
  if (payload.companyId && payload.transcript.trim().length >= 30) {
    work.push(
      post("/api/crm/commitments/detect", {
        companyId: payload.companyId,
        workstreamId: payload.workstreamId || null,
        text: payload.transcript,
        clientName: payload.candidate || null,
        source: payload.manualRecap ? "recap" : "call",
      })
    );
  }
  if (!payload.manualRecap && payload.transcript.trim().length >= 200) {
    work.push(
      post("/api/interview/coaching-learn", {
        transcript: payload.transcript,
        candidate: payload.candidate || null,
        callType: payload.callType || null,
      })
    );
  }
  const results = await Promise.allSettled(work);
  for (const result of results) {
    if (result.status === "rejected")
      console.error("Post-summary follow-up failed", result.reason);
  }
}

// Enrich the call-event row at end of call: stamp ended_at, the full transcript
// and the total cost onto the interview_sessions row created when the call went
// live. Best-effort and idempotent - never blocks ending a call.
export async function POST(req: NextRequest) {
  try {
    const accountScope = await resolveRecordScope();
    const { sessionId, transcript, totalCost, upcomingId, summaryRequest } =
      await req.json();
    if (!validMeetSessionId(sessionId)) {
      return NextResponse.json({ ok: false, skipped: "no sessionId" });
    }

    const patch: Record<string, any> = { ended_at: new Date().toISOString() };
    if (typeof transcript === "string" && transcript.trim()) {
      patch.transcript = transcript;
    }
    if (typeof totalCost === "number") {
      patch.total_cost = totalCost;
    }
    if (typeof upcomingId === "string" && upcomingId) {
      patch.upcoming_id = upcomingId;
    }

    const { error } = await supabaseAdmin
      .from("interview_sessions")
      .update(patch)
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("session_id", sessionId);
    if (error) throw error;

    await supabaseService
      .from("meet_stream_tokens")
      .update({
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("session_id", sessionId)
      .is("revoked_at", null);

    await supabaseService
      .from("livekit_join_invites")
      .update({
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("room_id", sessionId)
      .is("revoked_at", null);

    await supabaseService
      .from("livekit_rooms")
      .update({
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("room_id", sessionId)
      .is("revoked_at", null);

    // Ending the call clears the scheduled call it came from, so a finished
    // meeting drops off the upcoming list and stops spawning a prep to-do.
    const clearedUpcoming = await completeUpcomingForCall({
      sessionId,
      upcomingId: typeof upcomingId === "string" ? upcomingId : null,
    });

    let summaryQueued = false;
    if (
      typeof transcript === "string" &&
      transcript.trim().length >= 30 &&
      summaryRequest &&
      typeof summaryRequest === "object"
    ) {
      const initialPayload: CallSummaryPayload = {
        ...summaryRequest,
        transcript,
        sessionId,
        upcomingId:
          typeof upcomingId === "string" && upcomingId
            ? upcomingId
            : summaryRequest.upcomingId || null,
        cost:
          typeof totalCost === "number" ? totalCost : summaryRequest.cost || null,
      };
      const payload = await canonicalizeCallSummaryPayload(initialPayload);
      const processing = runCallSummaryJob(req, payload)
        .then(async (result) => {
          if (result.landed && !result.alreadyDone && result.summary)
            await postSummaryFollowups(req, payload, result.summary);
        })
        .catch((error) => console.error("Background call summary failed", error));
      waitUntil(processing);
      summaryQueued = true;
    }

    return NextResponse.json({ ok: true, clearedUpcoming, summaryQueued });
  } catch (err: any) {
    // Non-fatal: the scorecard (interview_summaries) is the primary record.
    return NextResponse.json(
      { ok: false, error: err?.message || "session-end failed" },
      { status: 200 }
    );
  }
}
