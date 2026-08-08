import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Selects the day's people only. It deliberately does NOT research, draft,
// approve or send. Those cost-bearing and external actions stay behind Lee's
// buttons in the outreach workspace.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "not authorised" }, { status: 401 });
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const response = await fetch(`${origin}/api/crm/outreach/queue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to build daily outreach queue" }, { status: 500 });
  }
}
