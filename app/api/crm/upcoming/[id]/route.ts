import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// PATCH /api/crm/upcoming/:id -> update a scheduled call (mark prepped, edit the
// intent, time, link, client). Only the provided fields are touched.
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
