import { NextRequest, NextResponse } from "next/server";

import { runNightlyLeadCleanse } from "@/lib/lead-cleanse-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel cron is UTC. 02:00 Europe/London is 02:00 UTC in winter and 01:00 UTC
// in summer, so both hours are scheduled and only the London 02:00 run proceeds.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const result = await runNightlyLeadCleanse();
  const status = result.ok ? 200 : result.error === "lead_bank_not_ready" ? 503 : 500;
  return NextResponse.json(result, { status });
}
