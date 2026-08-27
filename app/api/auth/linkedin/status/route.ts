import { NextResponse } from "next/server";
import {
  linkedinAccessStatus,
  linkedinConfigured,
} from "@/lib/linkedin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await linkedinAccessStatus();
    return NextResponse.json(
      { ...status, configured: linkedinConfigured() },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        status: "disconnected",
        connected: false,
        email: null,
        displayName: null,
        pictureUrl: null,
        socialAccess: false,
        expiresAt: null,
        configured: linkedinConfigured(),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
