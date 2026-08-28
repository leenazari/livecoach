import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import {
  SENDPILOT_MAX_WEBHOOK_BYTES,
  SendPilotContractError,
  parseSendPilotReplyEvent,
  verifySendPilotWebhookSignature,
} from "@/lib/sendpilot-contract";
import {
  bindSendPilotWorkspace,
  createSendPilotWebhookReceipt,
  decryptSendPilotWebhookSecret,
  loadSendPilotIntegrationByWebhookToken,
  processSendPilotReplyEvent,
} from "@/lib/sendpilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return NextResponse.json(
        { error: "application/json is required" },
        { status: 415, headers: noStore }
      );
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > SENDPILOT_MAX_WEBHOOK_BYTES) {
      return NextResponse.json(
        { error: "SendPilot webhook payload is too large" },
        { status: 413, headers: noStore }
      );
    }
    const integration = await loadSendPilotIntegrationByWebhookToken(params.token);
    if (!integration) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404, headers: noStore });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > SENDPILOT_MAX_WEBHOOK_BYTES) {
      return NextResponse.json(
        { error: "SendPilot webhook payload is too large" },
        { status: 413, headers: noStore }
      );
    }
    const secret = decryptSendPilotWebhookSecret(integration);
    if (
      !verifySendPilotWebhookSignature(
        rawBody,
        request.headers.get("webhook-signature"),
        secret
      )
    ) {
      return NextResponse.json(
        { error: "SendPilot webhook signature is invalid" },
        { status: 401, headers: noStore }
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "SendPilot webhook JSON is invalid" },
        { status: 400, headers: noStore }
      );
    }
    const event = parseSendPilotReplyEvent(payload);
    if (!(await bindSendPilotWorkspace(integration, event.workspaceId))) {
      return NextResponse.json(
        { error: "SendPilot workspace does not match this integration" },
        { status: 403, headers: noStore }
      );
    }
    const receipt = await createSendPilotWebhookReceipt(integration, event, rawBody);
    if (receipt.duplicate) {
      return NextResponse.json(
        { ok: true, duplicate: true },
        { status: 200, headers: noStore }
      );
    }
    waitUntil(processSendPilotReplyEvent(integration, receipt.id!, event));
    return NextResponse.json(
      { ok: true, accepted: true },
      { status: 202, headers: noStore }
    );
  } catch (error: any) {
    const status = error instanceof SendPilotContractError
      ? error.status
      : 500;
    if (status === 500) {
      console.error("SendPilot webhook failed", error?.message || error);
    }
    return NextResponse.json(
      {
        error:
          status === 500
            ? "SendPilot webhook failed"
            : String(error?.message || "SendPilot webhook failed"),
      },
      { status, headers: noStore }
    );
  }
}
