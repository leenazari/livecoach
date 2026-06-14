import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// The GLOBAL assistant thread (company_id null).
// GET    /api/crm/assistant/thread -> messages, oldest first
// DELETE /api/crm/assistant/thread -> clear the global thread
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("assistant_messages")
      .select("id, role, content, created_at")
      .is("company_id", null)
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

export async function DELETE() {
  try {
    const { error } = await supabaseAdmin
      .from("assistant_messages")
      .delete()
      .is("company_id", null);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to clear thread" },
      { status: 500 }
    );
  }
}
