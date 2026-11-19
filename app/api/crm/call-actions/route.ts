import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { prepareCallActions } from "@/lib/call-action-preparation";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import type { PreparedCallAction } from "@/lib/call-action-plan";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(status: number, reason: string) {
  return NextResponse.json(
    crmBlockerPayload({
      code: "call_action_preparation",
      title: "Call action preparation not confirmed",
      reason,
      nextAction:
        "Reopen this call to check the saved action pack and Tasks before trying again",
      responsible: "system",
    }),
    { status },
  );
}
async function loadCall(input: {
  callId?: string | null;
  sessionId?: string | null;
}) {
  const scope = requireRequestScope();
  let query = supabaseService
    .from("interview_summaries")
    .select(
      "id,session_id,post_call_package,post_call_preparation_state,post_call_preparation_error",
    )
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId);
  if (input.callId && uuid.test(input.callId))
    query = query.eq("id", input.callId);
  else if (input.sessionId && /^[a-zA-Z0-9:_-]{6,160}$/.test(input.sessionId))
    query = query.eq("session_id", input.sessionId);
  else return null;
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function GET(req: NextRequest) {
  try {
    const call = await loadCall({
      callId: req.nextUrl.searchParams.get("callId"),
      sessionId: req.nextUrl.searchParams.get("sessionId"),
    });
    if (!call)
      return fail(404, "This saved call is not available to your profile");
    const plan = call.post_call_package?.actionPreparation;
    if (req.nextUrl.searchParams.get("download") === "1") {
      const action = (plan?.actions || []).find(
        (a: PreparedCallAction) =>
          a.id === req.nextUrl.searchParams.get("actionId"),
      );
      if (!action || !action.body)
        return fail(404, "That prepared draft is unavailable");
      const { Document, Packer, Paragraph, HeadingLevel } = await import(
        "docx"
      );
      const content = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                text: action.subject || action.text,
                heading: HeadingLevel.TITLE,
              }),
              new Paragraph(
                "Draft for review. No message has been sent or meeting booked.",
              ),
              ...(action.missingDetails || []).map(
                (t: string) => new Paragraph(`To confirm: ${t}`),
              ),
              ...action.body
                .split("\n")
                .map((text: string) => new Paragraph(text)),
            ],
          },
        ],
      });
      const bytes = await Packer.toBuffer(content);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="call-action-${action.id}.docx"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return NextResponse.json(
      {
        callId: call.id,
        state: call.post_call_preparation_state || "not_started",
        error: call.post_call_preparation_error || null,
        plan: plan || null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return fail(500, "The saved action pack could not be loaded");
  }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const call = await loadCall(body);
    if (!call)
      return fail(404, "This saved call is not available to your profile");
    if (call.post_call_preparation_state === "ready")
      return NextResponse.json({ ok: true, existing: true });
    waitUntil(
      prepareCallActions(call.id, { manual: true }).catch(() =>
        console.error("Requested call action preparation failed", {
          callId: call.id,
        }),
      ),
    );
    return NextResponse.json({ ok: true, queued: true }, { status: 202 });
  } catch {
    return fail(500, "The action preparation request could not be confirmed");
  }
}
