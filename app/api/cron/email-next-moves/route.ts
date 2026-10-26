import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Compatibility endpoint for an already deployed schedule. Existing drafts
// remain intact, but even previously queued overnight tasks must now wait for
// an explicit user request in Notifications or Tasks. No AI calls or writes.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, skipped: "on_request", created: 0 });
}
