import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { dispatchDueOutreachMessage } from "@/lib/outreach-send-queue";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  try {
    const accounts = await listActiveAccountScopes({ connectedOnly: true });
    const results = await Promise.all(accounts.map(async (account) => {
      const result = await runWithServiceRecordScope(account, async () => {
        const now = new Date().toISOString();
        const { data: due, error } = await supabaseAdmin
          .from("outreach_messages")
          .select("id, scheduled_at")
          .eq("sender_user_id", account.userId)
          .eq("status", "approved")
          .not("scheduled_at", "is", null)
          .lte("scheduled_at", now)
          .or(`claim_expires_at.is.null,claim_expires_at.lte.${now}`)
          .order("scheduled_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return due ? dispatchDueOutreachMessage(due.id) : null;
      });
      return { userId: account.userId, result };
    }));
    return NextResponse.json({ ok: true, processed: results.filter((row) => row.result).length, results });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to process outreach send queue" },
      { status: 500 }
    );
  }
}
