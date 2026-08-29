import { NextResponse } from "next/server";
import {
  microsoftAccessStatus,
  microsoftConfigured,
} from "@/lib/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await microsoftAccessStatus();
    return NextResponse.json(
      { ...status, configured: microsoftConfigured() },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        status: "disconnected",
        email: null,
        mailRead: false,
        mailSend: false,
        mailDraft: false,
        calendar: false,
        configured: microsoftConfigured(),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
