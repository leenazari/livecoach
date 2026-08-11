import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { dispatchDueOutreachMessage } from "@/lib/outreach-send-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  try {
    const now = new Date().toISOString();
    const { data: due, error } = await supabaseAdmin
      .from("outreach_messages")
      .select("id, scheduled_at")
      .eq("status", "approved")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!due) return NextResponse.json({ ok: true, processed: 0 });
    const result = await dispatchDueOutreachMessage(due.id);
    return NextResponse.json({ ok: true, processed: 1, result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to process outreach send queue" },
      { status: 500 }
    );
  }
}
