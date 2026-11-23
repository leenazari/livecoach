import { NextRequest, NextResponse } from "next/server";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { runCallRecapEmails } from "@/lib/call-recap-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const accounts = await listActiveAccountScopes({ connectedOnly: true });
  const results = await Promise.all(accounts.map(async account => {
    try {
      return await runWithServiceRecordScope(account, () => runCallRecapEmails());
    } catch {
      console.error("Call recap email account processing was not confirmed");
      return { processed: 0, failed: true };
    }
  }));
  const failed = results.filter(r => "failed" in r).length;
  return NextResponse.json({ ok: failed === 0, accounts: accounts.length, processed: results.reduce((sum, r) => sum + r.processed, 0), failed }, { status: failed ? 503 : 200 });
}
