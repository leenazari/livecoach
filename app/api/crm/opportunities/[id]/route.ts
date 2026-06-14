import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// PATCH  /api/crm/opportunities/:id -> update status (open|won|lost|dismissed)
//        or edit title/detail/value.
// DELETE /api/crm/opportunities/:id
const STATUSES = ["open", "won", "lost", "dismissed"];

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
    if (typeof body.title === "string" && body.title.trim()) {
      patch.title = body.title.trim();
    }
    if (typeof body.detail === "string") patch.detail = body.detail.trim() || null;
    if (typeof body.value === "number") patch.value = body.value;
    if (body.value === null) patch.value = null;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .update(patch)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ opportunity: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update opportunity" },
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
      .from("opportunities")
      .delete()
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete opportunity" },
      { status: 500 }
    );
  }
}
