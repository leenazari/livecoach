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
// if a meeting just ends, or the tab closes, or the summariser times out, the
// call is fully captured yet has no scorecard.
//
// THE JAM (fixed here). This used to take orphans newest-first and process them
// sequentially inside its own 60s budget. So the first call that timed out ate
// the entire budget and the sweep died before reaching anything else. One
// un-summarisable call therefore blocked recovery for every call behind it,
// permanently. That is how eight calls were lost between 6 and 17 July while
// this ran every 15 minutes and appeared to be working.
//
// Three changes stop it happening again:
//   1. FEWEST ATTEMPTS FIRST, so a poisoned call can never hold the front of
//      the queue. A fresh call always overtakes a repeat failure.
//   2. THE ATTEMPT IS RECORDED BEFORE THE CALL IS MADE, so even a hard platform
//      timeout (which kills this function without running any cleanup) still
//      leaves a durable record. That is what makes the back-off real.
//   3. A TIME BUDGET plus per-call abort, so the sweep always exits cleanly and
//      gets through as many calls as it can rather than dying on the first.
//
// Failures are now written to the session (summary_error / summary_attempts) so
// they appear in Recent Calls as "summary failed" with a retry, instead of the
// call silently vanishing.

const BUDGET_MS = 42 * 1000; // leave headroom inside the 60s platform cap
const PER_CALL_MS = 38 * 1000;

// Back-off: wait longer between retries the more a call has failed, so a call
// that will never summarise costs one attempt every few hours instead of
// blocking the queue, but is never abandoned entirely.
function dueForRetry(attempts: number, lastTry: string | null): boolean {
  if (!attempts || !lastTry) return true;
  const waitMs = Math.min(attempts * 15 * 60 * 1000, 6 * 60 * 60 * 1000);
  const last = new Date(lastTry).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= waitMs;
}

async function run(req: Request) {
  const started = Date.now();
  try {
    const origin = new URL(req.url).origin;
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: sessions }, { data: summaries }] = await Promise.all([
      supabaseAdmin
        .from("interview_sessions")
        .select(
          "session_id, company_id, candidate, role, call_type, transcript, created_at, upcoming_id, updated_at, ended_at, summary_attempts, summary_last_try"
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

    const haveSummary = new Set((summaries || []).map((s: any) => s.session_id));

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
      // Respect the back-off so repeat failures cannot hog every run.
      if (!dueForRetry(Number(s.summary_attempts || 0), s.summary_last_try))
        return false;
      return true;
    });

    // FEWEST ATTEMPTS FIRST, then newest. This is the anti-jam ordering: a call
    // that has failed repeatedly always yields to one that has not been tried.
    orphans.sort((a: any, b: any) => {
      const aa = Number(a.summary_attempts || 0);
      const ba = Number(b.summary_attempts || 0);
      if (aa !== ba) return aa - ba;
      const at = new Date(a.created_at || 0).getTime();
      const bt = new Date(b.created_at || 0).getTime();
      return bt - at;
    });

    const done: string[] = [];
    const failed: string[] = [];

    for (const s of orphans) {
      // Stop starting new work once the budget is spent. Whatever is left is
      // picked up next run, in the same fair order.
      if (Date.now() - started > BUDGET_MS) break;

      // Record the attempt BEFORE trying. If the platform hard-kills this
      // function mid-summary, this row is already updated, so the back-off
      // still applies and this call cannot jam the next run.
      const attempts = Number(s.summary_attempts || 0) + 1;
      await supabaseAdmin
        .from("interview_sessions")
        .update({
          summary_attempts: attempts,
          summary_last_try: new Date().toISOString(),
        })
        .eq("session_id", s.session_id);

      let failure = "";
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_CALL_MS);
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
            signal: controller.signal,
          });
          if (!r.ok) failure = `summariser returned ${r.status}`;
        } finally {
          clearTimeout(timer);
        }
      } catch (e: any) {
        failure =
          e?.name === "AbortError"
            ? "the summary took too long and was stopped"
            : e?.message || "the summariser did not respond";
      }

      // A 200 is NOT proof a scorecard landed - a long call can fail inside
      // the summariser yet still return ok. Verify the row actually appeared.
      const { data: chk } = await supabaseAdmin
        .from("interview_summaries")
        .select("id")
        .eq("session_id", s.session_id)
        .limit(1);

      if (chk && chk.length) {
        done.push(s.session_id);
        await supabaseAdmin
          .from("interview_sessions")
          .update({ summary_error: null })
          .eq("session_id", s.session_id);
      } else {
        failed.push(s.session_id);
        await supabaseAdmin
          .from("interview_sessions")
          .update({
            summary_error:
              failure || "the summary did not complete, it will retry",
          })
          .eq("session_id", s.session_id);
      }
    }

    return NextResponse.json({
      ok: true,
      orphans: orphans.length,
      completed: done.length,
      sessions: done,
      failed,
      remaining: Math.max(0, orphans.length - done.length),
      ms: Date.now() - started,
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
