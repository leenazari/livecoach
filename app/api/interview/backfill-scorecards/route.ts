import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runCallSummaryJob } from "@/lib/call-summary-jobs";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { isVerifiedServiceRequest } from "@/lib/request-scope";
import { resolveRecordScope } from "@/lib/record-scope";

export const runtime = "nodejs";
export const maxDuration = 120;
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
//   3. A TIME BUDGET plus bounded summary calls, so the sweep exits cleanly and
//      gets through as many calls as it can rather than dying on the first.
//
// Failures are now written to the session (summary_error / summary_attempts) so
// they appear in Recent Calls as "summary failed" with a retry, instead of the
// call silently vanishing.

const BUDGET_MS = 105 * 1000;

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

async function runAccount(req: Request) {
  const started = Date.now();
  try {
    const accountScope = await resolveRecordScope();
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: sessions }, { data: summaries }] = await Promise.all([
      supabaseAdmin
        .from("interview_sessions")
        .select(
          "session_id, company_id, workstream_id, candidate, role, call_type, transcript, created_at, upcoming_id, updated_at, ended_at, summary_attempts, summary_last_try"
        )
        .eq("workspace_id", accountScope.workspaceId)
        .eq("owner_id", accountScope.userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("interview_summaries")
        .select("session_id")
        .eq("workspace_id", accountScope.workspaceId)
        .eq("owner_id", accountScope.userId)
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

      const result = await runCallSummaryJob(req, {
        transcript: s.transcript,
        role: s.role || null,
        candidate: s.candidate || null,
        competencies: [],
        callType: s.call_type || null,
        sessionId: s.session_id,
        companyId: s.company_id || null,
        workstreamId: s.workstream_id || null,
        upcomingId: s.upcoming_id || null,
      });

      if (result.landed) {
        done.push(s.session_id);
      } else if (!result.inProgress) {
        failed.push(s.session_id);
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

async function run(req: Request) {
  if (!isVerifiedServiceRequest()) return runAccount(req);
  try {
    const accounts = await listActiveAccountScopes();
    const results = await Promise.all(
      accounts.map(async (account) => {
        const response = await runWithServiceRecordScope(account, () =>
          runAccount(req)
        );
        return {
          userId: account.userId,
          status: response.status,
          result: await response.json(),
        };
      })
    );
    return NextResponse.json({
      ok: results.every((result) => result.status < 400),
      accounts: results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "call summary recovery failed" },
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
