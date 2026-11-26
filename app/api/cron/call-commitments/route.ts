import { NextRequest, NextResponse } from "next/server";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { runCallCommitmentReminders } from "@/lib/call-commitment-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const accounts = await listActiveAccountScopes();
  const results = await Promise.all(accounts.map(async account => {
    try {
      return await runWithServiceRecordScope(account, () => runCallCommitmentReminders());
    } catch {
      console.error("Call commitment reminder processing was not confirmed");
      return { reminded: 0, failed: true };
    }
  }));
  const failed = results.filter(r => "failed" in r).length;
  return NextResponse.json({ ok: failed === 0, reminded: results.reduce((n, r) => n + r.reminded, 0), failed }, { status: failed ? 503 : 200 });
}
