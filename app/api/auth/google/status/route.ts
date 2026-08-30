import { NextResponse } from "next/server";
import {
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  googleCanListCalendars,
  googleConnected,
  googleConfigured,
  googleGrantedScopes,
  GOOGLE_DRIVE_FILE_SCOPE,
} from "@/lib/google";
import { gmailAccessDiagnostic } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/google/status -> is a Google Calendar connected, and is the app
// even configured for it yet (env vars present)?
export async function GET() {
  try {
    const { connected, email } = await googleConnected();
    const [scopes, gmailDiagnostic] = connected
      ? await Promise.all([googleGrantedScopes(), gmailAccessDiagnostic()])
      : [
          new Set<string>(),
          { status: "disconnected" as const, issue: "disconnected" as const },
        ];
    // A successful Gmail API call is definitive. Tokeninfo is useful, but can
    // omit or fail to report scopes even when the live API grant works.
    const gmailRead =
      scopes.has(GMAIL_READ_SCOPE) || gmailDiagnostic.status === "ok";
    const gmailSend = scopes.has(GMAIL_SEND_SCOPE);
    const gmailDraft = scopes.has(GMAIL_COMPOSE_SCOPE);
    const drive = connected
      ? scopes.has(GOOGLE_DRIVE_FILE_SCOPE)
        ? "ok"
        : "missing"
      : "disconnected";
    const gmail = connected ? (gmailRead ? "ok" : "missing") : "disconnected";
    const calendarList = connected
      ? googleCanListCalendars(scopes)
        ? "ok"
        : "missing"
      : "disconnected";
    return NextResponse.json(
      {
        connected,
        email,
        configured: googleConfigured(),
        gmail,
        gmailSend,
        gmailDraft,
        gmailIssue: gmailRead ? "none" : gmailDiagnostic.issue,
        drive,
        driveReconnectRequired: connected && drive !== "ok",
        calendarList,
        calendarReconnectRequired: connected && calendarList !== "ok",
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      {
        connected: false,
        email: null,
        configured: false,
        gmail: "disconnected",
        gmailSend: false,
        gmailDraft: false,
        drive: "disconnected",
        driveReconnectRequired: false,
        calendarList: "disconnected",
        calendarReconnectRequired: false,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
