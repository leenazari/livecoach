import { NextRequest, NextResponse } from "next/server";
import { loadNotificationEmailWorkspace, draftNotificationEmail } from "@/lib/notification-email";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };
function failure(error: any) {
  const status = [400, 403, 404, 409, 502].includes(error?.status) ? error.status : 500;
  return NextResponse.json(crmBlockerPayload({
    code: `notification_email_${status}`, title: "Reply not ready",
    reason: status === 500 ? "LiveCoach could not load this reply safely" : error.message,
    nextAction: "Open the original conversation or correct the issue before trying again. Nothing has been sent.",
    responsible: "system",
  }), { status, headers });
}
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try { return NextResponse.json({ ok: true, ...await loadNotificationEmailWorkspace(params.id) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        (body.intent !== undefined && (typeof body.intent !== "string" || body.intent.length > 1000)) ||
        (body.regenerate !== undefined && typeof body.regenerate !== "boolean")) {
      throw Object.assign(new Error("Use up to 1,000 characters of reply instructions"), { status: 400 });
    }
    const draft = await draftNotificationEmail(params.id, { intent: body.intent, regenerate: body.regenerate === true });
    return NextResponse.json({ ok: true, draft }, { headers });
  } catch (error) { return failure(error); }
}
