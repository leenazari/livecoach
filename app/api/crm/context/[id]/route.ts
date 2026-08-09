import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// DELETE /api/crm/context/:id -> remove a client-context item.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("client_context")
      .delete()
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "context item not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deletedId: data.id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete context" },
      { status: 500 }
    );
  }
}
