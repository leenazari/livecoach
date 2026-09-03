import { NextRequest, NextResponse } from "next/server";

import { processOutreachResearchJobs } from "@/app/api/crm/outreach/research-jobs/processor";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { internalAppOrigin } from "@/lib/public-app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (
    !secret ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  try {
    const accounts = await listActiveAccountScopes();
    const origin = internalAppOrigin(request.nextUrl.origin);
    const results = await Promise.all(
      accounts.map((account) =>
        processOutreachResearchJobs({ account, origin })
      )
    );
    return NextResponse.json({
      ok: true,
      accounts: results.length,
      attempted: results.reduce((total, row) => total + row.attempted, 0),
      completed: results.reduce((total, row) => total + row.completed, 0),
      retrying: results.reduce((total, row) => total + row.retrying, 0),
      failed: results.reduce((total, row) => total + row.failed, 0),
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error?.message || "The outreach research recovery worker failed",
      },
      { status: 500 }
    );
  }
}
