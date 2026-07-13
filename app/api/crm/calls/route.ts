import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Without this, a no-arg GET() is statically optimised and Next caches the
// build-time snapshot, so newly assigned calls keep showing as unassigned even
// though the assignment saved to the DB. Force dynamic so the list is live.
export const dynamic = "force-dynamic";

// GET /api/crm/calls -> every recorded call, newest first, with the linked
// company name. Powers the calls list (name / company / date / cost).
//
// NO GAP: a call that had a scorecard is here, AND a scheduled call whose time
// has passed (so it dropped off the Upcoming list) but never got a scorecard is
// ALSO here, tagged as not-yet-summarised. So the moment a call leaves Upcoming
// it lands in Recent, whether or not it was run through LiveCoach.
export async function GET() {
  try {
    const now = Date.now();
    const grace = now - 3 * 60 * 60 * 1000; // matches the Upcoming past-cutoff
    const windowIso = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
    const [
      { data: companies },
      { data: calls },
      { data: sessions },
      { data: ups },
    ] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, session_id, candidate, role, company_id, created_at, cost, ref")
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("interview_sessions")
        .select("session_id, upcoming_id")
        .not("upcoming_id", "is", null)
        .limit(3000),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id, company_id, title, scheduled_at, completed_at")
        .gte("scheduled_at", windowIso)
        .limit(500),
    ]);
    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);

    const scored = (calls || []).map((c: any) => ({
      id: c.id,
      candidate: c.candidate,
      role: c.role,
      company_id: c.company_id,
      company: c.company_id ? nameById.get(c.company_id) || null : null,
      created_at: c.created_at,
      cost: c.cost,
      ref: c.ref || null,
      scored: true,
      upcoming_id: null as string | null,
    }));

    // Which scheduled calls already produced a scorecard, so we do not list them
    // twice: (a) the session that ran it links back to the upcoming id, and
    // (b) a scorecard for the same client within a few hours of its time.
    const summarySessionIds = new Set(
      (calls || []).map((c: any) => c.session_id).filter(Boolean)
    );
    const coveredUpcoming = new Set<string>();
    for (const s of sessions || [])
      if ((s as any).upcoming_id && summarySessionIds.has((s as any).session_id))
        coveredUpcoming.add((s as any).upcoming_id);
    const scoredTimes = (calls || [])
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

    const unscored = (ups || [])
      .filter((u: any) => {
        if (coveredUpcoming.has(u.id)) return false;
        const schedMs = u.scheduled_at ? new Date(u.scheduled_at).getTime() : 0;
        const past = !!u.completed_at || (schedMs > 0 && schedMs < grace);
        if (!past) return false;
        return !hasNearbyScore(u.company_id, schedMs || Date.parse(u.completed_at));
      })
      .map((u: any) => ({
        id: `upcoming:${u.id}`,
        candidate: u.title || "Call",
        role: null as string | null,
        company_id: u.company_id,
        company: u.company_id ? nameById.get(u.company_id) || null : null,
        created_at: u.completed_at || u.scheduled_at,
        cost: null,
        ref: null,
        scored: false,
        upcoming_id: u.id as string | null,
      }));

    const items = [...scored, ...unscored]
      .filter((c) => c.created_at)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .slice(0, 500);
    // Explicit no-store so no CDN/edge layer can serve a stale snapshot after a
    // call is (re)assigned - force-dynamic alone did not stop the stale read.
    return NextResponse.json(
      { calls: items },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load calls" },
      { status: 500 }
    );
  }
}
