import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// YOUR OWN NOTES ON A CALL.
//
// Typed during the call or added afterwards on the scorecard, and read back by
// the daily digest, which weights them heavily. What the model heard is one
// account of a call. What you thought about it is usually the more useful one.
//
// Stored inside the existing interview_summaries.summary jsonb as `userNotes`,
// NOT in a new column, so this needs no migration against a live database. The
// write merges, so it can never clobber the scorecard sitting beside it.
//
// House style: no em dashes, no semicolons.

const MAX = 8000;

export async function GET(req: NextRequest) {
  const sessionId = new URL(req.url).searchParams.get("sessionId") || "";
  if (!sessionId) return NextResponse.json({ notes: "" });
  try {
    const { data } = await supabaseAdmin
      .from("interview_summaries")
      .select("summary")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const notes =
      data && (data as any).summary && typeof (data as any).summary.userNotes === "string"
        ? (data as any).summary.userNotes
        : "";
    return NextResponse.json({ notes });
  } catch {
    return NextResponse.json({ notes: "" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const notes =
      typeof body.notes === "string" ? body.notes.slice(0, MAX) : "";

    if (!sessionId) {
      return NextResponse.json({ error: "no sessionId" }, { status: 400 });
    }

    // The scorecard row is written when the call is summarised, which may not
    // have happened yet if you are typing mid-call. Park the notes on the
    // session row until then, and the summary route folds them in.
    const { data: row } = await supabaseAdmin
      .from("interview_summaries")
      .select("id, summary")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({
        ok: true,
        pending: true,
        note: "no scorecard yet, notes will attach when the call is summarised",
        notes,
      });
    }

    // MERGE. Never write the summary object wholesale - it holds the whole
    // scorecard, and replacing it to save a note would destroy the lot.
    const existing = ((row as any).summary || {}) as any;
    const { error } = await supabaseAdmin
      .from("interview_summaries")
      .update({ summary: { ...existing, userNotes: notes } })
      .eq("id", (row as any).id);
    if (error) throw error;

    return NextResponse.json({ ok: true, saved: notes.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "could not save the notes" },
      { status: 500 }
    );
  }
}
