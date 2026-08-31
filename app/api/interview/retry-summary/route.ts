import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/supabase";
import { runCallSummaryJob } from "@/lib/call-summary-jobs";
import { resolveRecordScope } from "@/lib/record-scope";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// RETRY ONE CALL'S SUMMARY, on demand, from the Recent Calls list.
//
// The sweep already retries failures on a timer, but a call you are looking at
// right now should not need a 15 minute wait. This rebuilds the scorecard for a
// single session immediately and reports honestly whether it landed, so a
// failed call has a visible way out instead of sitting there.
//
// It clears the recorded error first so the row leaves the "failed" state while
// the attempt is running, and writes the outcome back either way.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId =
      typeof (body as any)?.sessionId === "string"
        ? (body as any).sessionId.trim()
        : "";
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    const accountScope = await resolveRecordScope();

    const { data: sess } = await supabaseAdmin
      .from("interview_sessions")
      .select(
        "session_id, transcript, role, candidate, call_type, company_id, workstream_id, upcoming_id"
      )
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    if (!sess) {
      return NextResponse.json({ error: "call not found" }, { status: 404 });
    }

    const transcript =
      typeof (sess as any).transcript === "string" ? (sess as any).transcript : "";
    if (transcript.trim().length < 500) {
      return NextResponse.json(
        { error: "there is not enough transcript to summarise" },
        { status: 422 }
      );
    }

    // Already done (the sweep may have got there first). Say so rather than
    // spending another model call.
    const { data: existing } = await supabaseAdmin
      .from("interview_summaries")
      .select("id")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("session_id", sessionId)
      .limit(1);
    if (existing && existing.length) {
      await supabaseAdmin
        .from("interview_sessions")
        .update({ summary_error: null })
        .eq("workspace_id", accountScope.workspaceId)
        .eq("owner_id", accountScope.userId)
        .eq("session_id", sessionId);
      return NextResponse.json({ ok: true, alreadyDone: true });
    }

    const processing = runCallSummaryJob(
      req,
      {
        transcript,
        role: (sess as any).role || null,
        candidate: (sess as any).candidate || null,
        competencies: [],
        callType: (sess as any).call_type || null,
        sessionId,
        companyId: (sess as any).company_id || null,
        workstreamId: (sess as any).workstream_id || null,
        upcomingId: (sess as any).upcoming_id || null,
      },
      { force: true }
    ).catch((error) => console.error("Manual summary retry failed", error));
    waitUntil(processing);

    return NextResponse.json(
      { ok: true, queued: true },
      { status: 202, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "retry failed" },
      { status: 500 }
    );
  }
}
