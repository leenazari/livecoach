import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { getCallRecapPreference, getCallRecapReceipts, saveCallRecapPreference } from "@/lib/call-recap-email";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function activeBrowser() {
  try { return requireRequestScope().status === "active"; } catch { return false; }
}
const blocked = (reason: string, status = 503, saving = false) => NextResponse.json(crmBlockerPayload({
  code: `CALL_RECAP_${status}`, title: saving ? "Recap email preference not confirmed" : "Recap email settings unavailable",
  reason, nextAction: saving ? "Reopen Settings to check whether the preference saved before changing it again." : "Sign in with an active workspace account and reopen Settings.",
}), { status, headers });

export async function GET(req: NextRequest) {
  if (!activeBrowser()) return blocked("Active workspace access is required.", 403);
  try {
    const callId = req.nextUrl.searchParams.get("callId") || undefined;
    if (callId && !/^[0-9a-f-]{36}$/i.test(callId)) return blocked("The call reference is invalid.", 400);
    const [preference, receipts] = await Promise.all([getCallRecapPreference(), getCallRecapReceipts(callId)]);
    return NextResponse.json({ ...preference, receipts }, { headers });
  } catch (error: any) {
    return blocked("Your personal recap settings could not be loaded.", error?.message === "RECAP_ACCESS_DENIED" ? 403 : 503);
  }
}

export async function PUT(req: NextRequest) {
  if (!activeBrowser()) return blocked("Active workspace access is required.", 403, true);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.enabled !== "boolean" || Object.keys(body).some(k => k !== "enabled"))
      return blocked("Choose whether recap emails are on or off. Recipients cannot be changed here.", 400, true);
    const preference = await saveCallRecapPreference(body.enabled);
    return NextResponse.json({ ok: true, ...preference }, { headers });
  } catch (error: any) {
    return blocked("The server did not confirm the preference change.", error?.message === "RECAP_ACCESS_DENIED" ? 403 : 503, true);
  }
}
