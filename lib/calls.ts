import { supabaseAdmin } from "@/lib/supabase";

// When a call ENDS, the scheduled call it came from should drop off the upcoming
// list and stop generating a prep to-do, so a finished meeting never lingers or
// double-counts. This marks the matching upcoming_call completed.
//
// Resolution order, most reliable first:
//   1. an explicit upcomingId (the call was started from that scheduled call),
//   2. otherwise the nearest not-yet-completed scheduled call for the same
//      client within a tight window around the call's time.
// It is conservative (same client + close in time) so it can't clear an
// unrelated future call, idempotent (only sets completed_at when still null),
// and best-effort (never throws into the caller).
export async function completeUpcomingForCall(opts: {
  sessionId?: string | null;
  companyId?: string | null;
  upcomingId?: string | null;
  callTimeMs?: number;
}): Promise<string | null> {
  try {
    const nowIso = new Date().toISOString();

    if (opts.upcomingId) {
      await supabaseAdmin
        .from("upcoming_calls")
        .update({ completed_at: nowIso })
        .eq("id", opts.upcomingId)
        .is("completed_at", null);
      return opts.upcomingId;
    }

    // Derive client + call time from the session row when not passed in. Also
    // read the scheduled-call link stamped at start: if the session knows the
    // exact slot it came from, complete THAT directly. This works even for a
    // call with no client link and for one that was never ended manually, so
    // the safety-net sweep clears the right slot too.
    let companyId = opts.companyId || null;
    let callTimeMs = opts.callTimeMs;
    if (opts.sessionId) {
      const { data: sess } = await supabaseAdmin
        .from("interview_sessions")
        .select("company_id, started_at, created_at, upcoming_id")
        .eq("session_id", opts.sessionId)
        .maybeSingle();
      if (sess) {
        const linked = (sess as any).upcoming_id as string | null;
        if (linked) {
          await supabaseAdmin
            .from("upcoming_calls")
            .update({ completed_at: nowIso })
            .eq("id", linked)
            .is("completed_at", null);
          return linked;
        }
        if (!companyId) companyId = (sess as any).company_id || null;
        if (callTimeMs == null) {
          const t = (sess as any).started_at || (sess as any).created_at;
          callTimeMs = t ? new Date(t).getTime() : Date.now();
        }
      }
    }
    if (!companyId) return null;
    if (callTimeMs == null) callTimeMs = Date.now();

    // A call usually starts on or just after its scheduled time, so look back a
    // little and forward a little around the call's actual time.
    const lo = new Date(callTimeMs - 6 * 60 * 60 * 1000).toISOString();
    const hi = new Date(callTimeMs + 2 * 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("upcoming_calls")
      .select("id, scheduled_at")
      .eq("company_id", companyId)
      .is("completed_at", null)
      .gte("scheduled_at", lo)
      .lte("scheduled_at", hi)
      .order("scheduled_at", { ascending: true })
      .limit(10);
    const rows = data || [];
    if (!rows.length) return null;

    let bestId: string | null = null;
    let bestDt = Infinity;
    for (const r of rows) {
      const dt = Math.abs(new Date(r.scheduled_at as string).getTime() - callTimeMs);
      if (dt < bestDt) {
        bestDt = dt;
        bestId = r.id as string;
      }
    }
    if (!bestId) return null;

    await supabaseAdmin
      .from("upcoming_calls")
      .update({ completed_at: nowIso })
      .eq("id", bestId)
      .is("completed_at", null);
    return bestId;
  } catch {
    return null;
  }
}
