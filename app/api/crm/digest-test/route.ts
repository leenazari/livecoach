import { NextRequest, NextResponse } from "next/server";
import { internalAppOrigin } from "@/lib/public-app-url";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Authenticated, same-user test send. The browser cannot choose the account or
// recipient. The service-only digest route resolves the signed-in user's own
// connected mailbox.
export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const secret = process.env.CRON_SECRET || "";
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: "email scheduling is not configured" },
        { status: 503 }
      );
    }

    const url = new URL(
      "/api/cron/daily-digest",
      internalAppOrigin(req.nextUrl.origin)
    );
    url.searchParams.set("force", "1");
    url.searchParams.set("account", account.userId);
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "verified workspace access is required",
      },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}

// GET supports an intentional top-level visit from an authenticated user's CRM
// session. It has the same exact-user restriction as POST.
export async function GET(req: NextRequest) {
  return POST(req);
}
