import { NextResponse } from "next/server";
import { googleConnected, googleConfigured } from "@/lib/google";
import { gmailAccessStatus } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/google/status -> is a Google Calendar connected, and is the app
// even configured for it yet (env vars present)?
export async function GET() {
  try {
    const { connected, email } = await googleConnected();
    const gmail = connected ? await gmailAccessStatus() : "disconnected";
    return NextResponse.json(
      { connected, email, configured: googleConfigured(), gmail },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      { connected: false, email: null, configured: false, gmail: "disconnected" },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
