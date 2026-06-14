import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET    /api/crm/companies/:id/assistant -> the chat thread (oldest first)
// DELETE /api/crm/companies/:id/assistant -> clear the thread
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("assistant_messages")
      .select("id, role, content, created_at")
      .eq("company_id", params.id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ messages: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load thread" },
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
      .from("assistant_messages")
      .delete()
      .eq("company_id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to clear thread" },
      { status: 500 }
    );
  }
}
