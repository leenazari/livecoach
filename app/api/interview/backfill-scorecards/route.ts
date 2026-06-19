import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;
// Self-called and live data, so it must be dynamic.
export const dynamic = "force-dynamic";

// SAFETY NET so a captured call is never lost.
//
// A call only gets a scorecard when "End call & summarise" is pressed. The Meet
// bot saves the session and full transcript on its own, but every call list in
// the app keys off the SCORECARD (interview_summaries), not the transcript. So
// if a meeting just ends, or the tab closes, or the user moves on without
// pressing the button, the call is fully captured yet has no scorecard and
// vanishes from every list. (The 2pm Alain call was exactly this.)
//
// This finds those orphans - a real transcript with no scorecard - and builds
// the scorecard automatically, reusing the normal summary endpoint so the result
// is identical to a manual one. Safe to run often: it only does work when an
// orphan exists, processes a small batch per run, and is idempotent.

async function run(req: Request) {
  try {
    const origin = new URL(req.url).origin;
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: sessions }, { data: summaries }] = await Promise.all([
      supabaseAdmin
        .from("interview_sessions")
        .select(
          "session_id, company_id, candidate, role, call_type, transcript, created_at, upcoming_id, updated_at, ended_at"
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("interview_summaries")
        .select("session_id")
        .not("session_id", "is", null)
        .limit(3000),
    ]);

    const haveSummary = new Set(
      (summaries || []).map((s: any) => s.session_id)
    );

    // A call is only "over" once it has gone quiet. The sweep runs on a timer,
    // so without this it could summarise a LONG call mid-flight (a live call
    // looks like an orphan: transcript present, no summary yet). Treat a session
    // as still live unless it has an explicit ended_at OR its last activity was
    // more than QUIET_MS ago. This is also what turns the sweep into auto-end:
    // a call that just stops, without being ended, is summarised ~12-27 min later.
    const QUIET_MS = 12 * 60 * 1000;
    const now = Date.now();
    const lastActivityMs = (s: any): number => {
      const v = s.updated_at || s.created_at;
      const t = v ? new Date(v).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    };

    const orphans = (sessions || []).filter((s: any) => {
      if (!s.session_id || haveSummary.has(s.session_id)) return false;
      const t = typeof s.transcript === "string" ? s.transcript.trim() : "";
      if (t.length < 500) return false; // too thin to be a real call
      // Still live: no end stamp and active within the quiet window. Leave it.
      if (!s.ended_at && now - lastActivityMs(s) < QUIET_MS) return false;
      // Skip the user's own practice / mic-test sessions (no client, self only).
      const cand = String(s.candidate || "").toLowerCase();
      if (!s.company_id && (cand === "" || cand.includes("lee nazari")) && t.length < 1500)
        return false;
      return true;
    });

    // Cap per run to stay within the time budget; the rest are caught next run.
    const batch = orphans.slice(0, 3);
    const done: string[] = [];
    for (const s of batch) {
      try {
        const r = await fetch(`${origin}/api/interview/summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: s.transcript,
            role: s.role || null,
            candidate: s.candidate || null,
            competencies: [],
            callType: s.call_type || null,
            sessionId: s.session_id,
            companyId: s.company_id || null,
            // Pass the linked slot so the summary endpoint completes the right
            // upcoming_calls row, clearing it from the list automatically.
            upcomingId: s.upcoming_id || null,
          }),
        });
        if (r.ok) done.push(s.session_id);
      } catch {
        /* skip - the next run retries this one */
      }
    }

    return NextResponse.json({
      ok: true,
      orphans: orphans.length,
      completed: done.length,
      sessions: done,
      remaining: Math.max(0, orphans.length - done.length),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "backfill failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
