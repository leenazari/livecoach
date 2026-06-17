import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { completeUpcomingForCall } from "@/lib/calls";

export const runtime = "nodejs";

// Enrich the call-event row at end of call: stamp ended_at, the full transcript
// and the total cost onto the interview_sessions row created when the call went
// live. Best-effort and idempotent - never blocks ending a call.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, transcript, totalCost, upcomingId } = await req.json();
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ ok: false, skipped: "no sessionId" });
    }

    const patch: Record<string, any> = { ended_at: new Date().toISOString() };
    if (typeof transcript === "string" && transcript.trim()) {
      patch.transcript = transcript;
    }
    if (typeof totalCost === "number") {
      patch.total_cost = totalCost;
    }

    const { error } = await supabaseAdmin
      .from("interview_sessions")
      .update(patch)
      .eq("session_id", sessionId);
    if (error) throw error;

    // Ending the call clears the scheduled call it came from, so a finished
    // meeting drops off the upcoming list and stops spawning a prep to-do.
    const clearedUpcoming = await completeUpcomingForCall({
      sessionId,
      upcomingId: typeof upcomingId === "string" ? upcomingId : null,
    });

    return NextResponse.json({ ok: true, clearedUpcoming });
  } catch (err: any) {
    // Non-fatal: the scorecard (interview_summaries) is the primary record.
    return NextResponse.json(
      { ok: false, error: err?.message || "session-end failed" },
      { status: 200 }
    );
  }
}
