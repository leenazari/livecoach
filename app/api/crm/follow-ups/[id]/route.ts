import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// PATCH  /api/crm/follow-ups/:id -> update status (draft|sent|dismissed) or edit
//        the draft subject/body the user tweaked before sending.
// DELETE /api/crm/follow-ups/:id
const STATUSES = ["draft", "sent", "dismissed"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = {};
    if (typeof body.status === "string" && STATUSES.includes(body.status)) {
      patch.status = body.status;
    }
    if (typeof body.draft_subject === "string") {
      patch.draft_subject = body.draft_subject;
    }
    if (typeof body.draft_body === "string") {
      patch.draft_body = body.draft_body;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from("follow_ups")
      .update(patch)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ followUp: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update follow-up" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { error } = await supabaseAdmin
      .from("follow_ups")
      .delete()
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete follow-up" },
      { status: 500 }
    );
  }
}
