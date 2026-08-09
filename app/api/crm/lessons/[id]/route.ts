import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// DELETE /api/crm/lessons/:id -> remove a lesson from the library.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("lessons")
      .delete()
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "lesson not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deletedId: data.id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete lesson" },
      { status: 500 }
    );
  }
}
