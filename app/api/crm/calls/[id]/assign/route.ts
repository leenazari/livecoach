import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractAttendees, mergeRoster } from "@/lib/roster";

export const runtime = "nodejs";
// POST with a body, so dynamic, but be explicit (see the 405 static-route lesson).
export const dynamic = "force-dynamic";

// Assign (or reassign) a recorded call to a client. [id] is EITHER the scorecard
// (interview_summaries) id, OR "session:<session_id>" for a captured call that
// has no scorecard yet. We stamp company_id on BOTH the scorecard AND its
// interview_sessions row (matched by session_id) so the call event and its
// scorecard can never drift apart. Pass companyId null to unassign.
//
// This is the safety net: a call that ended up with no client (the Alain case)
// can always be put right here, without ever changing the call's own id. The
// session: form is what the Recent Calls dropdown uses for a call whose summary
// has not landed yet, so an unattached call is never a dead end.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const body = await req.json();
    const companyId =
      typeof body.companyId === "string" && body.companyId
        ? body.companyId
        : null;

    // Normalise both id forms into { sessionId, candidate }.
    const isSession = id.startsWith("session:");
    let sessionId: string | null = null;
    let candidate: string | null = null;

    if (isSession) {
      sessionId = id.slice("session:".length);
      const { data: sess } = await supabaseAdmin
        .from("interview_sessions")
        .select("session_id, candidate")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (!sess) {
        return NextResponse.json({ error: "call not found" }, { status: 404 });
      }
      candidate = (sess as any).candidate ?? null;
    } else {
      const { data: row } = await supabaseAdmin
        .from("interview_summaries")
        .select("id, session_id, candidate")
        .eq("id", id)
        .single();
      if (!row) {
        return NextResponse.json({ error: "call not found" }, { status: 404 });
      }
      sessionId = row.session_id ?? null;
      candidate = row.candidate ?? null;

      const { error: e1 } = await supabaseAdmin
        .from("interview_summaries")
        .update({ company_id: companyId })
        .eq("id", id);
      if (e1) throw e1;
    }

    // Keep the call-event row in step (matched by session_id). For the session:
    // form this IS the write. Any scorecard that lands later inherits the client
    // from the session, so attaching early is never undone.
    if (sessionId) {
      await supabaseAdmin
        .from("interview_sessions")
        .update({ company_id: companyId })
        .eq("session_id", sessionId);
      if (isSession) {
        await supabaseAdmin
          .from("interview_summaries")
          .update({ company_id: companyId })
          .eq("session_id", sessionId);
      }
    }
    const row = { session_id: sessionId, candidate };

    // Learn the mispronunciation. If this call's heard name differs from the
    // client we just assigned it to, save it as an alias so future calls heard
    // as that name resolve automatically (the Elaine -> Alain case).
    // Conservative: only a plausible single name (no lists / sentences), never
    // if that name already belongs to another client.
    let learnedAlias: string | null = null;
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const heardRaw = typeof row.candidate === "string" ? row.candidate : "";
    const heard = norm(heardRaw);
    const plausibleName =
      !!companyId &&
      heard.length >= 2 &&
      heard.length <= 40 &&
      heard.split(" ").length <= 3 &&
      !heardRaw.includes(",");
    if (plausibleName) {
      const { data: comps } = await supabaseAdmin
        .from("companies")
        .select("id, name, profile");
      const target = (comps || []).find((c: any) => c.id === companyId);
      const usedElsewhere = (comps || []).some((c: any) => {
        if (c.id === companyId) return false;
        if (norm(c.name || "") === heard) return true;
        const al = Array.isArray((c.profile || {}).aliases)
          ? (c.profile as any).aliases
          : [];
        return al.some((a: any) => norm(String(a || "")) === heard);
      });
      if (target && !usedElsewhere) {
        const existing = Array.isArray((target.profile || {}).aliases)
          ? (target.profile as any).aliases.map((a: any) => norm(String(a || "")))
          : [];
        if (heard !== norm(target.name || "") && !existing.includes(heard)) {
          const profile = { ...((target.profile as any) || {}) };
          profile.aliases = [
            ...(Array.isArray(profile.aliases) ? profile.aliases : []),
            heard,
          ];
          await supabaseAdmin
            .from("companies")
            .update({ profile })
            .eq("id", companyId);
          learnedAlias = heard;
        }
      }
    }

    // Learn the roster: remember WHO was on this call for this client, so future
    // calls with the same people auto-link (this is what makes the standups, and
    // any recurring meeting, file themselves). Runs after the alias write above,
    // so it folds into the latest profile rather than clobbering it.
    let learnedRoster: string[] = [];
    try {
      if (companyId && row.session_id) {
        const { data: sess } = await supabaseAdmin
          .from("interview_sessions")
          .select("transcript")
          .eq("session_id", row.session_id)
          .maybeSingle();
        const attendees = extractAttendees((sess as any)?.transcript || "");
        if (attendees.size) {
          const { data: comp } = await supabaseAdmin
            .from("companies")
            .select("profile")
            .eq("id", companyId)
            .maybeSingle();
          const nextProfile = mergeRoster((comp as any)?.profile, attendees);
          await supabaseAdmin
            .from("companies")
            .update({ profile: nextProfile })
            .eq("id", companyId);
          learnedRoster = Array.from(attendees);
        }
      }
    } catch (e) {
      console.error("Roster learn failed:", e);
    }

    return NextResponse.json({ ok: true, companyId, learnedAlias, learnedRoster });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to assign call" },
      { status: 500 }
    );
  }
}
