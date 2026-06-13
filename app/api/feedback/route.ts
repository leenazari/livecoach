import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Stores a call's cue feedback (thumbs up/down) + debrief notes, keyed by
// session. Foundation for tuning future-call intelligence to the host's taste.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, liked, disliked, notes } = await req.json();
    const { error } = await supabaseAdmin.from("call_feedback").insert({
      session_id: typeof sessionId === "string" ? sessionId : null,
      liked: Array.isArray(liked) ? liked : [],
      disliked: Array.isArray(disliked) ? disliked : [],
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Feedback store error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to save feedback" },
      { status: 500 }
    );
  }
}
