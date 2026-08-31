import { NextRequest, NextResponse } from "next/server";

import {
  listScheduledSendPilotScopes,
  runSendPilotBackfill,
} from "@/lib/sendpilot";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_ACCOUNTS_PER_RUN = 6;
const CONCURRENCY = 2;

type ScheduledScope = { userId: string; workspaceId: string };

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await work(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function repairAccount(scope: ScheduledScope) {
  try {
    const result = await runSendPilotBackfill(scope);
    return {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      ok: true,
      imported: result.imported,
      messageDuplicates: result.duplicates,
      matchedLeads: result.leadReconciliation.matched,
      leadsForReview: result.leadReconciliation.review,
      workspaceDuplicatesBlocked:
        result.leadReconciliation.duplicatesBlocked,
      competingOutreachPaused:
        result.leadReconciliation.emailOutreachPaused,
      truncated: result.truncated,
    };
  } catch (error: any) {
    const message = String(error?.message || "SendPilot safety sync failed").slice(
      0,
      500
    );
    const alreadyRunning = Number(error?.status) === 429;
    return {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      ok: alreadyRunning,
      skipped: alreadyRunning,
      error: message,
    };
  }
}

// Webhooks remain the immediate path. This bounded repair pass is read and
// reconciliation only. It never calls the SendPilot lead-enrolment endpoint.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const scopes = await listScheduledSendPilotScopes(MAX_ACCOUNTS_PER_RUN);
    const results = await mapWithConcurrency(scopes, CONCURRENCY, repairAccount);
    const failed = results.filter((result) => !result.ok);
    console.log(
      JSON.stringify({
        level: failed.length ? "warning" : "info",
        msg: "SendPilot safety sync completed",
        accounts: results.length,
        failed: failed.length,
        ms: Date.now() - startedAt,
      })
    );
    return NextResponse.json({
      ok: failed.length === 0,
      mode: "inbound_repair",
      accounts: results,
      ms: Date.now() - startedAt,
    });
  } catch (error: any) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "SendPilot safety sync could not start",
        error: error?.message || "unknown error",
        ms: Date.now() - startedAt,
      })
    );
    return NextResponse.json(
      { error: error?.message || "SendPilot safety sync could not start" },
      { status: 500 }
    );
  }
}
