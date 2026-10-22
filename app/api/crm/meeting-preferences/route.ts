import { NextRequest, NextResponse } from "next/server";
import { setAppConfigValue } from "@/lib/app-config";
import { GOOGLE_MEET_ACCOUNT_KEY, normaliseMeetingAccountEmail } from "@/lib/meeting-account";
import { getMeetingAccountPreference, requireActiveMeetingAccountScope } from "@/lib/meeting-account-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    return NextResponse.json({ googleMeetEmail: await getMeetingAccountPreference() }, { headers });
  } catch {
    return NextResponse.json({ error: "Your meeting preference could not be loaded" }, { status: 403, headers });
  }
}

export async function PUT(req: NextRequest) {
  try {
    requireActiveMeetingAccountScope();
  } catch {
    return NextResponse.json({ error: "Active workspace access is required" }, { status: 403, headers });
  }
  const body = await req.json().catch(() => null);
  const email = normaliseMeetingAccountEmail(body?.googleMeetEmail);
  if (!body || Array.isArray(body) || Object.keys(body).some(key => key !== "googleMeetEmail") || email === null) {
    return NextResponse.json({ error: "Enter a valid Google account email, or leave it blank to use your browser default" }, { status: 400, headers });
  }
  try {
    const saved = await setAppConfigValue({
      key: GOOGLE_MEET_ACCOUNT_KEY,
      value: email,
      visibility: "private",
      note: "Browser-only Google Meet account preference. Does not change CRM login or calendar integration.",
    });
    return NextResponse.json({ ok: true, googleMeetEmail: saved.value || "" }, { headers });
  } catch {
    return NextResponse.json({ error: "Your meeting preference was not saved. Try again." }, { status: 503, headers });
  }
}
