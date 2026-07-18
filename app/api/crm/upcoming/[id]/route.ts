import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET /api/crm/upcoming/:id -> one scheduled call, including any saved prep plan
// (the prep jsonb), plus the linked company name. Lets the call screen reload a
// plan that was built in advance, instead of starting from a blank slate.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("upcoming_calls")
      .select(
        "id, company_id, title, scheduled_at, meeting_url, intent, prepped, prep, research, attendees"
      )
      .eq("id", params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    let company: string | null = null;
    if (data.company_id) {
      const { data: co } = await supabaseAdmin
        .from("companies")
        .select("name")
        .eq("id", data.company_id)
        .maybeSingle();
      company = co?.name || null;
    }
    return NextResponse.json({ call: { ...data, company } });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load the call" },
      { status: 500 }
    );
  }
}

// PATCH /api/crm/upcoming/:id -> update a scheduled call (mark prepped, edit the
// intent, time, link, client, or store the prep plan). Only provided fields are
// touched.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = {};
    if (typeof body.title === "string") patch.title = body.title.trim() || null;
    if ("scheduledAt" in body) patch.scheduled_at = body.scheduledAt || null;
    if (typeof body.meetingUrl === "string")
      patch.meeting_url = body.meetingUrl.trim() || null;
    if (typeof body.intent === "string")
      patch.intent = body.intent.trim() || null;
    if (typeof body.prepped === "boolean") patch.prepped = body.prepped;
    // Mark a call done (it happened) or re-open it. Clears it from the upcoming
    // list and the derived prep to-dos without deleting the row.
    if (typeof body.completed === "boolean")
      patch.completed_at = body.completed ? new Date().toISOString() : null;
    // The prep plan snapshot (focus, goals, opening questions, etc.) built in
    // advance on the call screen, so it survives leaving the page.
    if ("prep" in body) patch.prep = body.prep ?? null;
    if ("companyId" in body)
      patch.company_id =
        typeof body.companyId === "string" && body.companyId
          ? body.companyId
          : null;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true });
    }
    const { error } = await supabaseAdmin
      .from("upcoming_calls")
      .update(patch)
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update" },
      { status: 500 }
    );
  }
}

// POST /api/crm/upcoming/:id/cancel -> the call is OFF (cancelled, or it happened
// separately). Note the reason in the brain's memory so it is remembered, then
// remove the scheduled call - which drops it off the upcoming list AND its
// derived prep to-do at once. The calendar sync won't re-add it because the
// event is no longer on the calendar.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const reason =
      body && typeof body.reason === "string" ? body.reason.trim() : "";
    const { data: call } = await supabaseAdmin
      .from("upcoming_calls")
      .select("title, scheduled_at")
      .eq("id", params.id)
      .maybeSingle();
    // Record the reason in the brain's learned memory so it sticks.
    try {
      const { data: prof } = await supabaseAdmin
        .from("workspace_profile")
        .select("learned")
        .eq("id", "main")
        .maybeSingle();
      const prev =
        prof && typeof prof.learned === "string" ? prof.learned.trim() : "";
      const when = call?.scheduled_at
        ? new Date(call.scheduled_at).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          })
        : "";
      const note = `Call "${call?.title || "(untitled)"}"${
        when ? ` (${when})` : ""
      } is not happening${reason ? `. Reason: ${reason}` : " (cancelled)"}.`;
      let next = prev ? `${prev}\n- ${note}` : `- ${note}`;
      if (next.length > 8000) next = next.slice(-8000);
      await supabaseAdmin
        .from("workspace_profile")
        .update({ learned: next })
        .eq("id", "main");
    } catch {
      /* noting the reason is best-effort */
    }
    const { error } = await supabaseAdmin
      .from("upcoming_calls")
      .delete()
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to cancel the call" },
      { status: 500 }
    );
  }
}

// DELETE /api/crm/upcoming/:id -> remove a scheduled call.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { error } = await supabaseAdmin
      .from("upcoming_calls")
      .delete()
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete" },
      { status: 500 }
    );
  }
}
