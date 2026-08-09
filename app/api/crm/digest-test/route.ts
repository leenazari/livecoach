import { NextRequest, NextResponse } from "next/server";
import { GET as sendDigest } from "@/app/api/cron/daily-digest/route";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Authenticated, same-recipient test send. Middleware protects every /api/crm
// route with the signed-in Supabase session, and the digest itself remains
// protected by CRON_SECRET. The recipient is still fixed inside the digest,
// so this can never be used to send to customers or an arbitrary address.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "email scheduling is not configured" },
      { status: 503 }
    );
  }

  const url = new URL("/api/cron/daily-digest", req.url);
  url.searchParams.set("force", "1");
  const cronRequest = new NextRequest(url, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
  return sendDigest(cronRequest);
}

// GET supports an intentional top-level visit from Lee's authenticated CRM
// session. This route is not linked or prefetched anywhere, and the fixed
// recipient means a visit can only send Lee his own test brief.
export async function GET(req: NextRequest) {
  return POST(req);
}
