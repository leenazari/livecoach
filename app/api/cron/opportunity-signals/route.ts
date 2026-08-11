import { NextRequest, NextResponse } from "next/server";
import { processQueuedOpportunitySignals } from "@/lib/opportunity-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await processQueuedOpportunitySignals(6)) });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "opportunity signal processing failed" },
      { status: 500 }
    );
  }
}
