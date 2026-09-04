import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { shouldShowUnrecordedScheduledCall } from "@/lib/call-list-recovery";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
// Without this, a no-arg GET() is statically optimised and Next caches the
// build-time snapshot, so newly assigned calls keep showing as unassigned even
// though the assignment saved to the DB. Force dynamic so the list is live.
export const dynamic = "force-dynamic";

// GET /api/crm/calls -> every recorded call, newest first, with the linked
// company name. Powers the calls list (name / company / date / cost).
//
// NOTHING IS EVER INVISIBLE. Three sources are merged, in priority order:
//   1. SCORECARDS (interview_summaries)          -> state "scored"
//   2. CAPTURED SESSIONS with no scorecard yet   -> "summarising" or "failed"
//   3. PAST SCHEDULED CALLS never run in the app -> "unrecorded"
//
// (2) is the one that matters. A captured call whose summary times out used to
// exist only as a transcript row and appeared in NO list anywhere, so it looked
// deleted (the 2pm Emma call, and seven others going back to 6 July). Now the
// call shows up the moment it is captured, carries its own state, and can be
// retried or attached to a client from the list. A call with no client attached
// is listed too, flagged needsClient, rather than being filtered out.
export async function GET() {
  try {
    const account = requireRequestScope();
    const now = Date.now();
    const grace = now - 3 * 60 * 60 * 1000; // matches the Upcoming past-cutoff
    const windowIso = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
    const { data: accessRows, error: accessError } = await supabaseService
      .from("meet_capture_access")
      .select("capture_id,access_role")
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", account.userId)
      .is("revoked_at", null)
      .limit(500);
    if (accessError) throw accessError;
    const captureIds = (accessRows || []).map((row: any) => row.capture_id);
    const { data: sharedCaptures, error: captureError } = captureIds.length
      ? await supabaseService
          .from("meet_bots")
          .select("id,session_id,host_owner_id")
          .eq("workspace_id", account.workspaceId)
          .in("id", captureIds)
      : { data: [], error: null };
    if (captureError) throw captureError;
    const sharedSessionIds = Array.from(
      new Set(
        (sharedCaptures || [])
          .map((row: any) => String(row.session_id || ""))
          .filter(Boolean)
      )
    );

    const [
      { data: companies },
      { data: calls },
      { data: sessions },
      { data: ups },
      { data: sharedCalls },
      { data: sharedSessions },
    ] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, session_id, candidate, role, company_id, created_at, cost, ref")
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("interview_sessions")
        .select(
          "session_id, upcoming_id, candidate, role, company_id, created_at, updated_at, ended_at, transcript, total_cost, summary_attempts, summary_error"
        )
        .gte("created_at", windowIso)
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id, company_id, title, scheduled_at, completed_at")
        .gte("scheduled_at", windowIso)
        .limit(500),
      sharedSessionIds.length
        ? supabaseService
            .from("interview_summaries")
            .select("id, session_id, candidate, role, company_id, created_at, cost, ref")
            .eq("workspace_id", account.workspaceId)
            .in("session_id", sharedSessionIds)
            .limit(500)
        : Promise.resolve({ data: [] }),
      sharedSessionIds.length
        ? supabaseService
            .from("interview_sessions")
            .select(
              "session_id, upcoming_id, candidate, role, company_id, created_at, updated_at, ended_at, transcript, total_cost, summary_attempts, summary_error"
            )
            .eq("workspace_id", account.workspaceId)
            .in("session_id", sharedSessionIds)
            .gte("created_at", windowIso)
            .limit(500)
        : Promise.resolve({ data: [] }),
    ]);
    const callIds = new Set((calls || []).map((row: any) => row.id));
    const allCalls = [
      ...(calls || []),
      ...(sharedCalls || []).filter((row: any) => !callIds.has(row.id)),
    ];
    const ownedSessionIds = new Set(
      (sessions || []).map((row: any) => String(row.session_id || ""))
    );
    const allSessions = [
      ...(sessions || []),
      ...(sharedSessions || []).filter(
        (row: any) => !ownedSessionIds.has(String(row.session_id || ""))
      ),
    ];
    const sharedCompanyIds = Array.from(
      new Set(
        [...(sharedCalls || []), ...(sharedSessions || [])]
          .map((row: any) => row.company_id)
          .filter(Boolean)
      )
    );
    const { data: sharedCompanies } = sharedCompanyIds.length
      ? await supabaseService
          .from("companies")
          .select("id,name")
          .eq("workspace_id", account.workspaceId)
          .in("id", sharedCompanyIds)
      : { data: [] };
    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);
    const linkableCompanyIds = new Set(
      (companies || []).map((company: any) => String(company.id))
    );
    for (const c of sharedCompanies || []) nameById.set(c.id, c.name);
    const nameOf = (id: string | null) => (id ? nameById.get(id) || null : null);

    type Item = {
      id: string;
      candidate: string | null;
      role: string | null;
      company_id: string | null;
      company: string | null;
      created_at: string;
      cost: number | string | null;
      ref: string | null;
      scored: boolean;
      state: "scored" | "summarising" | "failed" | "unrecorded";
      session_id: string | null;
      upcoming_id: string | null;
      attempts: number;
      error: string | null;
      needsClient: boolean;
      hasTranscript: boolean;
      sharedCall: boolean;
    };

    const transcriptSessionIds = new Set(
      allSessions
        .filter(
          (session: any) =>
            session.session_id &&
            typeof session.transcript === "string" &&
            session.transcript.trim().length > 0
        )
        .map((session: any) => session.session_id)
    );

    // 1. SCORECARDS.
    const scored: Item[] = allCalls.map((c: any) => ({
      id: c.id,
      candidate: c.candidate,
      role: c.role,
      company_id:
        c.company_id && linkableCompanyIds.has(String(c.company_id))
          ? c.company_id
          : null,
      company: nameOf(c.company_id || null),
      created_at: c.created_at,
      cost: c.cost,
      ref: c.ref || null,
      scored: true,
      state: "scored",
      session_id: c.session_id || null,
      upcoming_id: null,
      attempts: 0,
      error: null,
      needsClient: !c.company_id,
      hasTranscript: !!c.session_id && transcriptSessionIds.has(c.session_id),
      sharedCall: sharedSessionIds.includes(String(c.session_id || "")),
    }));

    const summarySessionIds = new Set(
      allCalls.map((c: any) => c.session_id).filter(Boolean)
    );

    // 2. CAPTURED SESSIONS with a real transcript but no scorecard. These are
    // the ones that used to vanish. A session is only "failed" once the sweep
    // has actually tried and recorded an error, otherwise it is still in flight.
    const QUIET_MS = 12 * 60 * 1000;
    const lastActivity = (s: any) => {
      const v = s.updated_at || s.created_at;
      const t = v ? new Date(v).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    };
    const captured: Item[] = allSessions
      .filter((s: any) => {
        if (!s.session_id || summarySessionIds.has(s.session_id)) return false;
        const t = typeof s.transcript === "string" ? s.transcript.trim() : "";
        if (t.length < 500) return false; // mic tests and stubs are not calls
        return true;
      })
      .map((s: any) => {
        const attempts = Number(s.summary_attempts || 0);
        const stillLive = !s.ended_at && now - lastActivity(s) < QUIET_MS;
        const state: Item["state"] =
          !stillLive && (s.summary_error || attempts >= 3)
            ? "failed"
            : "summarising";
        return {
          id: `session:${s.session_id}`,
          candidate: s.candidate || "Untitled call",
          role: s.role || null,
          company_id:
            s.company_id && linkableCompanyIds.has(String(s.company_id))
              ? s.company_id
              : null,
          company: nameOf(s.company_id || null),
          created_at: s.ended_at || s.created_at,
          cost: s.total_cost ?? null,
          ref: null,
          scored: false,
          state,
          session_id: s.session_id,
          upcoming_id: s.upcoming_id || null,
          attempts,
          error: s.summary_error || null,
          needsClient: !s.company_id,
          hasTranscript: true,
          sharedCall: sharedSessionIds.includes(String(s.session_id || "")),
        };
      });

    // 3. PAST SCHEDULED CALLS that were never run through the app at all (no
    // scorecard AND no captured session), so a missed call still shows up.
    const coveredUpcoming = new Set<string>();
    const startedWithoutCapture = new Set<string>();
    for (const s of allSessions) {
      const upcomingId = String((s as any).upcoming_id || "");
      if (!upcomingId) continue;
      const transcript =
        typeof (s as any).transcript === "string"
          ? (s as any).transcript.trim()
          : "";
      if (
        transcript.length >= 500 ||
        summarySessionIds.has((s as any).session_id)
      ) {
        coveredUpcoming.add(upcomingId);
      } else {
        startedWithoutCapture.add(upcomingId);
      }
    }
    const scoredTimes = allCalls
      .filter((c: any) => c.company_id && c.created_at)
      .map((c: any) => ({
        company_id: c.company_id as string,
        ms: new Date(c.created_at).getTime(),
      }));
    const hasNearbyScore = (companyId: string | null, ms: number) =>
      !!companyId &&
      scoredTimes.some(
        (s) => s.company_id === companyId && Math.abs(s.ms - ms) <= 4 * 60 * 60 * 1000
      );

    const unrecorded: Item[] = (ups || [])
      .filter((u: any) => isPrepEligibleCalendarEvent(u))
      .filter((u: any) => {
        if (coveredUpcoming.has(u.id)) return false;
        const schedMs = u.scheduled_at ? new Date(u.scheduled_at).getTime() : 0;
        const past = shouldShowUnrecordedScheduledCall({
          scheduledAt: u.scheduled_at,
          completedAt: u.completed_at,
          nowMs: now,
          graceMs: 3 * 60 * 60 * 1000,
          startedWithoutCapture: startedWithoutCapture.has(u.id),
        });
        if (!past) return false;
        return !hasNearbyScore(u.company_id, schedMs || Date.parse(u.completed_at));
      })
      .map((u: any) => ({
        id: `upcoming:${u.id}`,
        candidate: u.title || "Call",
        role: null,
        company_id: u.company_id || null,
        company: nameOf(u.company_id || null),
        created_at: u.completed_at || u.scheduled_at,
        cost: null,
        ref: null,
        scored: false,
        state: "unrecorded" as const,
        session_id: null,
        upcoming_id: u.id as string,
        attempts: 0,
        error: null,
        needsClient: !u.company_id,
        hasTranscript: false,
        sharedCall: false,
      }));

    const items = [...scored, ...captured, ...unrecorded]
      .filter((c) => c.created_at)
      .sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
      )
      .slice(0, 500);

    // Explicit no-store so no CDN/edge layer can serve a stale snapshot after a
    // call is (re)assigned - force-dynamic alone did not stop the stale read.
    return NextResponse.json(
      {
        calls: items,
        needsAttention: items.filter(
          (c) => c.state === "failed" || (c.scored && c.needsClient)
        ).length,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load calls" },
      { status: 500 }
    );
  }
}
