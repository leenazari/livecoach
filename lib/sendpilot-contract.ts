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

export type SendPilotMessageSentEvent = {
  eventId: string;
  eventType: "message.sent";
  timestamp: string;
  workspaceId: string;
  data: {
    leadId: string;
    campaignId: string;
    linkedinUrl: string;
    senderId: string;
    message: string;
    sequenceStep: number | null;
  };
};

export type SendPilotConnectionRequestSentEvent = {
  eventId: string;
  eventType: "connection_request.sent";
  timestamp: string;
  workspaceId: string;
  data: {
    leadId: string;
    campaignId: string;
    linkedinUrl: string;
    senderId: string;
    note: string | null;
  };
};

export type SendPilotConnectionRequestAcceptedEvent = {
  eventId: string;
  eventType: "connection_request.accepted";
  timestamp: string;
  workspaceId: string;
  data: {
    leadId: string;
    campaignId: string;
    linkedinUrl: string;
    senderId: string;
    acceptedAt: string;
  };
};

export type SendPilotLeadUpdatedEvent = {
  eventId: string;
  eventType: "lead.updated";
  timestamp: string;
  workspaceId: string;
  data: {
    leadId: string;
    campaignId: string;
    linkedinUrl: string;
    previousStatus: string;
    newStatus: string;
  };
};

export type SendPilotWebhookEvent =
  | SendPilotReplyEvent
  | SendPilotMessageSentEvent
  | SendPilotConnectionRequestSentEvent
  | SendPilotConnectionRequestAcceptedEvent
  | SendPilotLeadUpdatedEvent;

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

export function parseSendPilotWebhookEvent(value: unknown): SendPilotWebhookEvent {
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
  if (
    !eventId ||
    !workspaceId ||
    ![
      "reply.received",
      "message.sent",
      "connection_request.sent",
      "connection_request.accepted",
      "lead.updated",
    ].includes(eventType)
  ) {
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
  const linkedinUrl = clean(details.linkedinUrl, 1_000);
  const campaignId = clean(details.campaignId, 240);
  if (!leadId || !linkedinUrl || !campaignId) {
    throw new SendPilotContractError("SendPilot reply data is incomplete");
  }
  const base = {
    eventId,
    timestamp: new Date(timestampMs).toISOString(),
    workspaceId,
  };
  if (eventType === "lead.updated") {
    const previousStatus = clean(details.previousStatus, 80);
    const newStatus = clean(details.newStatus, 80);
    if (!previousStatus || !newStatus) {
      throw new SendPilotContractError("SendPilot lead status data is incomplete");
    }
    return {
      ...base,
      eventType,
      data: { leadId, campaignId, linkedinUrl, previousStatus, newStatus },
    };
  }
  const senderId = clean(details.senderId, 240);
  if (!senderId) {
    throw new SendPilotContractError("SendPilot sender data is incomplete");
  }
  if (eventType === "reply.received") {
    const reply = clean(details.reply, 8_000);
    if (!reply) throw new SendPilotContractError("SendPilot reply data is incomplete");
    return {
      ...base,
      eventType,
      data: { leadId, campaignId, linkedinUrl, senderId, reply },
    };
  }
  if (eventType === "message.sent") {
    const message = clean(details.message, 8_000);
    const rawStep = Number(details.sequenceStep);
    const sequenceStep = Number.isInteger(rawStep) && rawStep >= 0 && rawStep <= 100
      ? rawStep
      : null;
    if (!message) throw new SendPilotContractError("SendPilot message data is incomplete");
    return {
      ...base,
      eventType,
      data: { leadId, campaignId, linkedinUrl, senderId, message, sequenceStep },
    };
  }
  if (eventType === "connection_request.sent") {
    return {
      ...base,
      eventType,
      data: {
        leadId,
        campaignId,
        linkedinUrl,
        senderId,
        note: clean(details.note, 3_000) || null,
      },
    };
  }
  const acceptedAtRaw = clean(details.acceptedAt, 80);
  const acceptedAtMs = new Date(acceptedAtRaw).getTime();
  if (!Number.isFinite(acceptedAtMs)) {
    throw new SendPilotContractError("SendPilot connection timestamp is invalid");
  }
  return {
    ...base,
    eventType: "connection_request.accepted",
    data: {
      leadId,
      campaignId,
      linkedinUrl,
      senderId,
      acceptedAt: new Date(acceptedAtMs).toISOString(),
    },
  };
}

export function parseSendPilotReplyEvent(value: unknown): SendPilotReplyEvent {
  const event = parseSendPilotWebhookEvent(value);
  if (event.eventType !== "reply.received") {
    throw new SendPilotContractError("Unsupported SendPilot webhook event");
  }
  return event;
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
