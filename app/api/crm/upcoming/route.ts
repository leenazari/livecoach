import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";

export const runtime = "nodejs";
// Keep this a dynamic function: a no-arg GET would otherwise be statically
// optimised and the POST would 405 (INVALID_REQUEST_METHOD) at the edge.
export const dynamic = "force-dynamic";

// GET /api/crm/upcoming -> scheduled calls, soonest first, with the linked
// company name. Powers the dashboard's Upcoming Calls card.
export async function GET() {
  try {
    // Hide calls whose time has passed by more than a short grace window (3h),
    // so a just-finished call sticks around long enough to open/recap, then
    // drops off on its own. Calls with no set time are always kept.
    const pastCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    // Keep a short recovery window for calls marked done. This lets the user
    // reopen an accidentally hidden call without exposing another person's
    // calendar or duplicating the source event.
    const recoveryCutoff = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000
    ).toISOString();
    const nowIso = new Date().toISOString();
    const [
      { data: companies },
      { data: calls },
      { data: recentlyCompleted },
    ] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin
        .from("upcoming_calls")
        .select(
          "id, company_id, title, scheduled_at, meeting_url, intent, prepped, source, created_at"
        )
        // A finished call (completed_at set on end) drops off here at once.
        .is("completed_at", null)
        .or(`scheduled_at.is.null,scheduled_at.gte.${pastCutoff}`)
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .limit(200),
      supabaseAdmin
        .from("upcoming_calls")
        .select(
          "id, company_id, title, scheduled_at, meeting_url, intent, prepped, source, created_at, completed_at"
        )
        .not("completed_at", "is", null)
        // Always include a future call, even if it was hidden more than two
        // weeks ago. Otherwise keep the recovery list deliberately short.
        .or(`completed_at.gte.${recoveryCutoff},scheduled_at.gte.${nowIso}`)
        .order("completed_at", { ascending: false })
        .limit(20),
    ]);
    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);
    const items = (calls || [])
      .filter((c: any) => isPrepEligibleCalendarEvent(c))
      .map((c: any) => ({
        ...c,
        company: c.company_id ? nameById.get(c.company_id) || null : null,
      }));
    const recoverable = (recentlyCompleted || [])
      .filter((c: any) => isPrepEligibleCalendarEvent(c))
      .map((c: any) => ({
        ...c,
        company: c.company_id ? nameById.get(c.company_id) || null : null,
      }));
    return NextResponse.json(
      { calls: items, recentlyCompleted: recoverable },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load upcoming calls" },
      { status: 500 }
    );
  }
}

// POST /api/crm/upcoming -> schedule a new call.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title && !body.companyId) {
      return NextResponse.json(
        { error: "give the call a title or a client" },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseAdmin
      .from("upcoming_calls")
      .insert({
        company_id:
          typeof body.companyId === "string" && body.companyId
            ? body.companyId
            : null,
        title: title || null,
        scheduled_at: body.scheduledAt || null,
        meeting_url:
          typeof body.meetingUrl === "string" && body.meetingUrl.trim()
            ? body.meetingUrl.trim()
            : null,
        intent:
          typeof body.intent === "string" && body.intent.trim()
            ? body.intent.trim()
            : null,
        prepped: false,
        source: "manual",
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to schedule the call" },
      { status: 500 }
    );
  }
}
