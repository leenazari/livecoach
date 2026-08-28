export const LINKEDIN_INBOX_MAX_CONVERSATIONS = 20;
export const LINKEDIN_INBOX_MAX_MESSAGES = 200;
export const LINKEDIN_INBOX_MAX_MESSAGES_PER_24_HOURS = 500;
export const LINKEDIN_INBOX_MAX_BODY_LENGTH = 8_000;
export const LINKEDIN_INBOX_MAX_LOOKBACK_DAYS = 14;

export type LinkedInInboxMessageInput = {
  direction: "inbound";
  conversationId: string;
  messageId: string;
  senderName: string;
  senderProfileUrl: string;
  body: string;
  receivedAt: string;
};

export type LinkedInInboxBatch = {
  runId: string;
  capturedAt: string;
  conversationCount: number;
  messages: LinkedInInboxMessageInput[];
};

export class LinkedInInboxContractError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LinkedInInboxContractError";
    this.status = status;
  }
}

const text = (value: unknown, max: number) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max);
};

export function normaliseLinkedInProfileUrl(value: unknown): string | null {
  const raw = text(value, 1_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      !(host === "linkedin.com" || host.endsWith(".linkedin.com"))
    ) {
      return null;
    }
    const match = url.pathname.match(/^\/in\/([^/?#]+)\/?$/i);
    const slug = match?.[1]?.trim();
    if (!slug || !/^[a-z0-9_%.-]{2,200}$/i.test(slug)) return null;
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return null;
  }
}

export function normaliseStoredLinkedInProfileUrl(
  value: unknown
): string | null {
  const raw = text(value, 1_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      url.protocol === "http:" &&
      (host === "linkedin.com" || host.endsWith(".linkedin.com"))
    ) {
      url.protocol = "https:";
    }
    return normaliseLinkedInProfileUrl(url.toString());
  } catch {
    return null;
  }
}

const validIso = (value: unknown, field: string) => {
  const raw = text(value, 80);
  const ms = new Date(raw).getTime();
  if (!raw || !Number.isFinite(ms)) {
    throw new LinkedInInboxContractError(`${field} must be a valid timestamp`);
  }
  return new Date(ms).toISOString();
};

const boundedInteger = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new LinkedInInboxContractError(
      `${field} must be between ${minimum} and ${maximum}`
    );
  }
  return parsed;
};

export function parseLinkedInInboxBatch(
  value: unknown,
  limits: { maxConversations: number; lookbackDays: number },
  nowMs = Date.now()
): LinkedInInboxBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LinkedInInboxContractError("A JSON import batch is required");
  }
  const input = value as Record<string, unknown>;
  const runId = text(input.runId, 120);
  if (!/^[a-z0-9_-]{8,120}$/i.test(runId)) {
    throw new LinkedInInboxContractError("runId is invalid");
  }
  const capturedAt = validIso(input.capturedAt, "capturedAt");
  const capturedMs = new Date(capturedAt).getTime();
  if (capturedMs > nowMs + 10 * 60 * 1_000) {
    throw new LinkedInInboxContractError("capturedAt is in the future");
  }
  const maxConversations = Math.min(
    LINKEDIN_INBOX_MAX_CONVERSATIONS,
    Math.max(1, Math.trunc(limits.maxConversations || 1))
  );
  const conversationCount = boundedInteger(
    input.conversationCount,
    "conversationCount",
    0,
    maxConversations
  );
  if (!Array.isArray(input.messages)) {
    throw new LinkedInInboxContractError("messages must be an array");
  }
  if (input.messages.length > LINKEDIN_INBOX_MAX_MESSAGES) {
    throw new LinkedInInboxContractError(
      `messages cannot exceed ${LINKEDIN_INBOX_MAX_MESSAGES}`
    );
  }

  const lookbackDays = Math.min(
    LINKEDIN_INBOX_MAX_LOOKBACK_DAYS,
    Math.max(1, Math.trunc(limits.lookbackDays || 1))
  );
  const oldestAllowed = nowMs - lookbackDays * 24 * 60 * 60 * 1_000;
  const seen = new Set<string>();
  const profileByConversation = new Map<string, string>();
  const messages: LinkedInInboxMessageInput[] = [];

  for (const raw of input.messages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new LinkedInInboxContractError("Each message must be an object");
    }
    const item = raw as Record<string, unknown>;
    if (item.direction !== "inbound") {
      throw new LinkedInInboxContractError("Only inbound messages are accepted");
    }
    const conversationId = text(item.conversationId, 500);
    const messageId = text(item.messageId, 1_000);
    const senderName = text(item.senderName, 240);
    const senderProfileUrl = normaliseLinkedInProfileUrl(item.senderProfileUrl);
    const body = text(item.body, LINKEDIN_INBOX_MAX_BODY_LENGTH);
    const receivedAt = validIso(item.receivedAt, "receivedAt");
    const receivedMs = new Date(receivedAt).getTime();

    if (!conversationId || !messageId || !senderName || !senderProfileUrl || !body) {
      throw new LinkedInInboxContractError(
        "Each message needs a conversation id, message id, sender, profile and body"
      );
    }
    if (receivedMs > nowMs + 10 * 60 * 1_000) {
      throw new LinkedInInboxContractError("A message timestamp is in the future");
    }
    const establishedProfile = profileByConversation.get(conversationId);
    if (establishedProfile && establishedProfile !== senderProfileUrl) {
      throw new LinkedInInboxContractError(
        "A conversation cannot contain multiple sender identities"
      );
    }
    profileByConversation.set(conversationId, senderProfileUrl);
    if (receivedMs < oldestAllowed) continue;
    if (seen.has(messageId)) continue;
    seen.add(messageId);
    messages.push({
      direction: "inbound",
      conversationId,
      messageId,
      senderName,
      senderProfileUrl,
      body,
      receivedAt,
    });
  }

  if (profileByConversation.size > conversationCount) {
    throw new LinkedInInboxContractError(
      "conversationCount is smaller than the imported conversation set"
    );
  }

  return { runId, capturedAt, conversationCount, messages };
}
