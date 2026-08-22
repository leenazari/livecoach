import { NextRequest, NextResponse } from "next/server";
import { publicAppOrigin } from "@/lib/public-app-url";
import { requireRequestScope } from "@/lib/request-scope";
import {
  createCandidateInvite,
  realtimeErrorStatus,
} from "@/lib/realtime-token-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const room = typeof body?.room === "string" ? body.room : "";
    const invite = await createCandidateInvite(scope, room);
    const url = new URL(`/join/${encodeURIComponent(room)}`, publicAppOrigin(req.nextUrl.origin));
    // Keep the single-use secret in the URL fragment. Fragments are not sent
    // in HTTP requests, provider logs or cross-origin referrers.
    url.hash = `invite=${invite.rawToken}`;

    return NextResponse.json(
      { joinUrl: url.toString(), expiresAt: invite.expiresAt },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not create the secure call link" },
      {
        status: realtimeErrorStatus(error),
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  }
}
