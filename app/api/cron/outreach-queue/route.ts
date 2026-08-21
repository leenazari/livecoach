import { NextRequest, NextResponse } from "next/server";
import { POST as buildQueue } from "@/app/api/crm/outreach/queue/route";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Selects the day's people only. It deliberately does NOT research, draft,
// approve or send. Those cost-bearing and external actions stay behind Lee's
// buttons in the outreach workspace.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "not authorised" }, { status: 401 });
  try {
    const accounts = await listActiveAccountScopes();
    const results = await Promise.all(accounts.map(async (account) => {
      const response = await runWithServiceRecordScope(account, () =>
        buildQueue(new NextRequest(new URL("/api/crm/outreach/queue", req.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }))
      );
      return { userId: account.userId, status: response.status, body: await response.json() };
    }));
    return NextResponse.json({ ok: true, accounts: results });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to build daily outreach queue" }, { status: 500 });
  }
}
