import "server-only";

const SENDPILOT_API_ORIGIN = "https://api.sendpilot.ai";
const SENDPILOT_API_TIMEOUT_MS = 8_000;
const SENDPILOT_MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;

export type SendPilotSender = {
  id: string;
  name: string;
  linkedinUrl: string;
  status: "active" | "disconnected" | "rate_limited";
};

export type SendPilotConversation = {
  id: string;
  accountId: string;
  participants: Array<{
    id?: string;
    name?: string;
    profileUrl?: string;
  }>;
  lastActivityAt?: string;
};

export type SendPilotMessage = {
  id: string;
  content: string;
  sender?: { id?: string; name?: string; profileUrl?: string };
  recipient?: { id?: string; name?: string; profileUrl?: string };
  direction: "sent" | "received";
  sentAt: string;
  contentType?: string;
};

export type SendPilotLead = {
  id: string;
  linkedinUrl: string;
  firstName?: string | null;
  lastName?: string | null;
  campaignId?: string;
};

export class SendPilotApiError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message);
    this.name = "SendPilotApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const string = (value: unknown, maximum = 1_000) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

async function sendPilotGet(path: string, apiKey: string): Promise<any> {
  if (!path.startsWith("/v1/")) throw new Error("SendPilot API path is invalid");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SENDPILOT_API_TIMEOUT_MS);
  try {
    const response = await fetch(`${SENDPILOT_API_ORIGIN}${path}`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
        "User-Agent": "LiveCoach-SendPilot-Inbound/1.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > SENDPILOT_MAX_RESPONSE_BYTES) {
      throw new SendPilotApiError("SendPilot returned too much data", 502, null);
    }
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new SendPilotApiError("SendPilot returned an invalid response", 502, null);
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const message = response.status === 429
        ? "SendPilot is rate-limiting inbox access. Wait a little before retrying."
        : response.status === 401 || response.status === 403
          ? "SendPilot rejected this workspace API key"
          : string(body?.message, 300) || "SendPilot could not complete the request";
      throw new SendPilotApiError(
        message,
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : null
      );
    }
    return body;
  } catch (error: any) {
    if (error instanceof SendPilotApiError) throw error;
    if (error?.name === "AbortError") {
      throw new SendPilotApiError("SendPilot did not respond in time", 504, null);
    }
    throw new SendPilotApiError("SendPilot could not be reached", 502, null);
  } finally {
    clearTimeout(timer);
  }
}

export async function listSendPilotSenders(apiKey: string): Promise<SendPilotSender[]> {
  const body = await sendPilotGet("/v1/inbox/senders", apiKey);
  if (!Array.isArray(body?.senders)) {
    throw new SendPilotApiError("SendPilot sender data is invalid", 502, null);
  }
  return body.senders.flatMap((value: any) => {
    const id = string(value?.id, 240);
    const name = string(value?.name, 240);
    const linkedinUrl = string(value?.linkedinUrl, 1_000);
    const status = string(value?.status, 40);
    if (
      !id ||
      !name ||
      !linkedinUrl ||
      !["active", "disconnected", "rate_limited"].includes(status)
    ) {
      return [];
    }
    return [{ id, name, linkedinUrl, status: status as SendPilotSender["status"] }];
  });
}

export async function listSendPilotConversations(
  apiKey: string,
  input: { accountId: string; continuationToken?: string | null; limit?: number }
): Promise<{
  conversations: SendPilotConversation[];
  continuationToken: string | null;
  hasMore: boolean;
}> {
  const query = new URLSearchParams({
    accountId: input.accountId,
    limit: String(Math.min(100, Math.max(1, input.limit || 100))),
  });
  if (input.continuationToken) {
    query.set("continuationToken", input.continuationToken);
  }
  const body = await sendPilotGet(`/v1/inbox/conversations?${query}`, apiKey);
  if (!Array.isArray(body?.conversations)) {
    throw new SendPilotApiError("SendPilot conversation data is invalid", 502, null);
  }
  const conversations = body.conversations.flatMap((value: any) => {
    const id = string(value?.id, 500);
    const accountId = string(value?.accountId, 240);
    if (!id || !accountId || !Array.isArray(value?.participants)) return [];
    return [{
      id,
      accountId,
      participants: value.participants.map((participant: any) => ({
        id: string(participant?.id, 240) || undefined,
        name: string(participant?.name, 240) || undefined,
        profileUrl: string(participant?.profileUrl, 1_000) || undefined,
      })),
      lastActivityAt: string(value?.lastActivityAt, 80) || undefined,
    }];
  });
  return {
    conversations,
    continuationToken: string(body?.pagination?.continuationToken, 4_000) || null,
    hasMore: body?.pagination?.hasMore === true,
  };
}

export async function getSendPilotConversationMessages(
  apiKey: string,
  input: {
    accountId: string;
    conversationId: string;
    continuationToken?: string | null;
    limit?: number;
  }
): Promise<{
  messages: SendPilotMessage[];
  continuationToken: string | null;
  hasMore: boolean;
}> {
  const query = new URLSearchParams({
    accountId: input.accountId,
    limit: String(Math.min(100, Math.max(1, input.limit || 100))),
  });
  if (input.continuationToken) {
    query.set("continuationToken", input.continuationToken);
  }
  const conversationId = encodeURIComponent(input.conversationId);
  const body = await sendPilotGet(
    `/v1/inbox/conversations/${conversationId}/messages?${query}`,
    apiKey
  );
  if (!Array.isArray(body?.messages)) {
    throw new SendPilotApiError("SendPilot message data is invalid", 502, null);
  }
  const messages = body.messages.flatMap((value: any) => {
    const id = string(value?.id, 1_000);
    const content = string(value?.content, 8_000);
    const direction = string(value?.direction, 20);
    const sentAt = string(value?.sentAt, 80);
    if (!id || !content || !["sent", "received"].includes(direction) || !sentAt) {
      return [];
    }
    return [{
      id,
      content,
      direction: direction as SendPilotMessage["direction"],
      sentAt,
      contentType: string(value?.contentType, 80) || undefined,
      sender: value?.sender && typeof value.sender === "object" ? {
        id: string(value.sender.id, 240) || undefined,
        name: string(value.sender.name, 240) || undefined,
        profileUrl: string(value.sender.profileUrl, 1_000) || undefined,
      } : undefined,
      recipient: value?.recipient && typeof value.recipient === "object" ? {
        id: string(value.recipient.id, 240) || undefined,
        name: string(value.recipient.name, 240) || undefined,
        profileUrl: string(value.recipient.profileUrl, 1_000) || undefined,
      } : undefined,
    }];
  });
  return {
    messages,
    continuationToken: string(body?.pagination?.continuationToken, 4_000) || null,
    hasMore: body?.pagination?.hasMore === true,
  };
}

export async function getSendPilotLead(
  apiKey: string,
  leadId: string
): Promise<SendPilotLead> {
  const body = await sendPilotGet(`/v1/leads/${encodeURIComponent(leadId)}`, apiKey);
  const id = string(body?.id, 240);
  const linkedinUrl = string(body?.linkedinUrl, 1_000);
  if (!id || !linkedinUrl) {
    throw new SendPilotApiError("SendPilot lead data is invalid", 502, null);
  }
  return {
    id,
    linkedinUrl,
    firstName: string(body?.firstName, 120) || null,
    lastName: string(body?.lastName, 120) || null,
    campaignId: string(body?.campaignId, 240) || undefined,
  };
}
