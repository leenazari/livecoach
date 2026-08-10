import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Persists the call's INTENT (what it's for, who it's with, the focus set)
// keyed by room id, upserting so it's safe to call more than once. This is the
// groundwork for: (1) generating a scorecard when a call ends unattended - a
// server job can read the transcript from meet_utterances + this intent and
// score it without the browser; (2) saved call history; (3) per-user accounts
// (interview_sessions already carries a user_id, currently null).
export async function POST(req: NextRequest) {
  try {
    const {
      sessionId,
      brief,
      role,
      callType,
      competencies,
      candidate,
      source,
      companyId,
      upcomingId,
    } = await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId (room) is required" },
        { status: 400 }
      );
    }

    // Save the scheduled-call identity in the SAME write that creates the
    // session. The old client flow created the row and then fired a separate
    // update, so an unlinked calendar event (or a fast network response) could
    // miss that second write and later be guessed as the next nearby meeting.
    const exactUpcomingId =
      typeof upcomingId === "string" && upcomingId ? upcomingId : null;
    let exactCompanyId =
      typeof companyId === "string" && companyId ? companyId : null;
    if (exactUpcomingId && !exactCompanyId) {
      const { data: scheduled, error: scheduledError } = await supabaseAdmin
        .from("upcoming_calls")
        .select("company_id")
        .eq("id", exactUpcomingId)
        .maybeSingle();
      if (scheduledError) throw scheduledError;
      if (scheduled?.company_id) exactCompanyId = scheduled.company_id as string;
    }

    const { error } = await supabaseAdmin.from("interview_sessions").upsert(
      {
        session_id: sessionId,
        brief: typeof brief === "string" && brief.trim() ? brief : null,
        role: typeof role === "string" && role.trim() ? role : null,
        call_type: typeof callType === "string" ? callType : null,
        competencies: Array.isArray(competencies) ? competencies : null,
        candidate: typeof candidate === "string" && candidate.trim() ? candidate : null,
        source: typeof source === "string" ? source : null,
        company_id: exactCompanyId,
        upcoming_id: exactUpcomingId,
      },
      { onConflict: "session_id" }
    );

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Session persist error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to persist session" },
      { status: 500 }
    );
  }
}
