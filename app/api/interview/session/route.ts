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
    const { sessionId, brief, role, callType, competencies, candidate, source } =
      await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId (room) is required" },
        { status: 400 }
      );
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
