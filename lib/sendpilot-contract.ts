import { createHash, createHmac, timingSafeEqual } from "crypto";

export const SENDPILOT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1_000;
export const SENDPILOT_MAX_WEBHOOK_BYTES = 128 * 1_024;
export const SENDPILOT_BACKFILL_DAYS = 14;
export const SENDPILOT_BACKFILL_MAX_CONVERSATIONS = 100;

export type SendPilotReplyEvent = {
  eventId: string;
  eventType: "reply.received";
  timestamp: string;
  workspaceId: string;
  data: {
    leadId: string;
    campaignId: string | null;
    linkedinUrl: string;
    senderId: string;
    reply: string;
  };
};

export class SendPilotContractError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SendPilotContractError";
    this.status = status;
  }
}

const clean = (value: unknown, maximum: number) =>
  typeof value === "string"
    ? value.replace(/\u0000/g, "").trim().slice(0, maximum)
    : "";

export function verifySendPilotWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs = Date.now()
): boolean {
  const values = new Map<string, string>();
  for (const part of String(header || "").split(",")) {
    const [key, value, extra] = part.trim().split("=");
    if (!key || !value || extra || values.has(key)) return false;
    values.set(key, value);
  }
  const timestamp = values.get("t") || "";
  const provided = values.get("s") || "";
  if (!/^\d{10,16}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(provided)) {
    return false;
  }
  const numericTimestamp = Number(timestamp);
  const timestampMs = numericTimestamp < 1_000_000_000_000
    ? numericTimestamp * 1_000
    : numericTimestamp;
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(nowMs - timestampMs) > SENDPILOT_WEBHOOK_TOLERANCE_MS
  ) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  const supplied = Buffer.from(provided, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseSendPilotReplyEvent(value: unknown): SendPilotReplyEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SendPilotContractError("A SendPilot webhook event is required");
  }
  const input = value as Record<string, unknown>;
  const eventId = clean(input.eventId, 240);
  const eventType = clean(input.eventType, 80);
  const workspaceId = clean(input.workspaceId, 240);
  const timestampRaw = clean(input.timestamp, 80);
  const timestampMs = new Date(timestampRaw).getTime();
  const data = input.data;
  if (!eventId || eventType !== "reply.received" || !workspaceId) {
    throw new SendPilotContractError("Unsupported SendPilot webhook event");
  }
  if (!Number.isFinite(timestampMs)) {
    throw new SendPilotContractError("SendPilot webhook timestamp is invalid");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new SendPilotContractError("SendPilot reply data is missing");
  }
  const details = data as Record<string, unknown>;
  const leadId = clean(details.leadId, 240);
  const senderId = clean(details.senderId, 240);
  const linkedinUrl = clean(details.linkedinUrl, 1_000);
  const reply = clean(details.reply, 8_000);
  const campaignId = clean(details.campaignId, 240) || null;
  if (!leadId || !senderId || !linkedinUrl || !reply) {
    throw new SendPilotContractError("SendPilot reply data is incomplete");
  }
  return {
    eventId,
    eventType: "reply.received",
    timestamp: new Date(timestampMs).toISOString(),
    workspaceId,
    data: { leadId, campaignId, linkedinUrl, senderId, reply },
  };
}

export function sendPilotMessageFingerprint(input: {
  senderProfileUrl: string;
  receivedAt: string;
  body: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.senderProfileUrl,
        new Date(input.receivedAt).toISOString(),
        input.body.replace(/\r\n/g, "\n").trim(),
      ].join("\u001f")
    )
    .digest("hex");
  return `sendpilot_${digest}`;
}
