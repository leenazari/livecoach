import { NextResponse } from "next/server";
import { googleConnected, googleConfigured } from "@/lib/google";

export const runtime = "nodejs";

// GET /api/auth/google/status -> is a Google Calendar connected, and is the app
// even configured for it yet (env vars present)?
export async function GET() {
  try {
    const { connected, email } = await googleConnected();
    return NextResponse.json({ connected, email, configured: googleConfigured() });
  } catch {
    return NextResponse.json({ connected: false, email: null, configured: false });
  }
}
