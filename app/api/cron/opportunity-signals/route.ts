import { NextRequest, NextResponse } from "next/server";
import { processQueuedOpportunitySignals } from "@/lib/opportunity-signals";
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
    const accounts = await listActiveAccountScopes();
    const results = await Promise.all(accounts.map(async (account) => {
      const result = await runWithServiceRecordScope(account, () =>
        processQueuedOpportunitySignals(6)
      );
      return { userId: account.userId, ...result };
    }));
    return NextResponse.json({
      ok: true,
      processed: results.reduce((sum, row) => sum + row.processed, 0),
      accounts: results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "opportunity signal processing failed" },
      { status: 500 }
    );
  }
}
