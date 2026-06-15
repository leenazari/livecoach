import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/crm/upcoming -> scheduled calls, soonest first, with the linked
// company name. Powers the dashboard's Upcoming Calls card.
export async function GET() {
  try {
    // Hide calls whose time has passed by more than a short grace window (3h),
    // so a just-finished call sticks around long enough to open/recap, then
    // drops off on its own. Calls with no set time are always kept.
    const pastCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const [{ data: companies }, { data: calls }] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin
        .from("upcoming_calls")
        .select(
          "id, company_id, title, scheduled_at, meeting_url, intent, prepped, source, created_at"
        )
        .or(`scheduled_at.is.null,scheduled_at.gte.${pastCutoff}`)
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .limit(200),
    ]);
    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);
    const items = (calls || []).map((c: any) => ({
      ...c,
      company: c.company_id ? nameById.get(c.company_id) || null : null,
    }));
    return NextResponse.json({ calls: items });
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
