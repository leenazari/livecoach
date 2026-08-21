import { NextRequest, NextResponse } from "next/server";
import { sweepOutreachReplies } from "@/lib/outreach-replies";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "not authorised" }, { status: 401 });
  try {
    const accounts = await listActiveAccountScopes({ connectedOnly: true });
    const results = await Promise.all(accounts.map(async (account) => {
      const result = await runWithServiceRecordScope(account, () =>
        sweepOutreachReplies(20, account.userId)
      );
      return { userId: account.userId, ...result };
    }));
    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to check replies" }, { status: 500 });
  }
}
