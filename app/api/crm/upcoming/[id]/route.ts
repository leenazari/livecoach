import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

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
        "id, company_id, title, scheduled_at, meeting_url, intent, prepped, prep"
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
