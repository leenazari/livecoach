import { NextRequest, NextResponse } from "next/server";
import { isGoogleMeetLaunchUrl, withGoogleMeetingAccount } from "@/lib/meeting-account";
import { getMeetingAccountPreference } from "@/lib/meeting-account-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

// This endpoint only chooses the browser account. It never joins a call,
// starts a bot, modifies an event or changes the CRM/calendar identity.
export async function GET(req: NextRequest) {
  const meetingUrl = req.nextUrl.searchParams.get("url") || "";
  if (!isGoogleMeetLaunchUrl(meetingUrl)) {
    return NextResponse.json({ error: "A valid Google Meet link is required" }, { status: 400, headers });
  }
  try {
    const email = await getMeetingAccountPreference();
    return NextResponse.redirect(withGoogleMeetingAccount(meetingUrl, email), { status: 307, headers });
  } catch {
    // Don't silently use the wrong Google account after a failed preference
    // read. The existing call screen and canonical link remain available.
    return NextResponse.json(
      { error: "Could not load your meeting account. Return to LiveCoach, check you are signed in and try opening the meeting again." },
      { status: 503, headers }
    );
  }
}
