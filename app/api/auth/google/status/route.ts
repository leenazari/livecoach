import { NextResponse } from "next/server";
import {
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  googleConnected,
  googleConfigured,
  googleGrantedScopes,
} from "@/lib/google";
import { gmailAccessStatus } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/google/status -> is a Google Calendar connected, and is the app
// even configured for it yet (env vars present)?
export async function GET() {
  try {
    const { connected, email } = await googleConnected();
    const [scopes, gmailApi] = connected
      ? await Promise.all([googleGrantedScopes(), gmailAccessStatus()])
      : [new Set<string>(), "disconnected" as const];
    // A successful Gmail API call is definitive. Tokeninfo is useful, but can
    // omit or fail to report scopes even when the live API grant works.
    const gmailRead = scopes.has(GMAIL_READ_SCOPE) || gmailApi === "ok";
    const gmailSend = scopes.has(GMAIL_SEND_SCOPE);
    const gmail = connected ? (gmailRead ? "ok" : "missing") : "disconnected";
    return NextResponse.json(
      { connected, email, configured: googleConfigured(), gmail, gmailSend },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      { connected: false, email: null, configured: false, gmail: "disconnected", gmailSend: false },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
