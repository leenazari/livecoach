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
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  status?: string | null;
  customLeadStatus?: string | null;
  campaignId?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SendPilotCampaign = {
  id: string;
  name: string;
  status: "started" | "paused" | "draft" | "finished";
  totalLeads: number;
  connectionsSent: number;
  messagesSent: number;
  repliesReceived: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SendPilotLeadInput = {
  linkedinUrl: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  title?: string;
  livecoachProspectId?: string;
  livecoachEnrolmentId?: string;
  livecoachCampaignId?: string;
  leadSource?: string;
};

export type SendPilotAddLeadsResult = {
  success: boolean;
  leadsAdded: number;
  duplicatesSkipped: number;
  invalidEntries: number;
  errors: Array<{
    index: number | null;
    linkedinUrl: string | null;
    reason: string;
  }>;
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

async function sendPilotRequest(
  path: string,
  apiKey: string,
  input: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}
): Promise<any> {
  if (!path.startsWith("/v1/")) throw new Error("SendPilot API path is invalid");
  const method = input.method || "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SENDPILOT_API_TIMEOUT_MS);
  try {
    const response = await fetch(`${SENDPILOT_API_ORIGIN}${path}`, {
      method,
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "LiveCoach-SendPilot-CRM/1.0",
      },
      ...(method !== "GET" ? { body: JSON.stringify(input.body || {}) } : {}),
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

async function sendPilotGet(path: string, apiKey: string): Promise<any> {
  return sendPilotRequest(path, apiKey);
}

const wholeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

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
    email: string(body?.email, 320).toLowerCase() || null,
    firstName: string(body?.firstName, 120) || null,
    lastName: string(body?.lastName, 120) || null,
    company: string(body?.company, 240) || null,
    title: string(body?.title, 240) || null,
    status: string(body?.status, 80) || null,
    customLeadStatus: string(body?.customLeadStatus, 80) || null,
    campaignId: string(body?.campaignId, 240) || undefined,
    createdAt: string(body?.createdAt, 80) || null,
    updatedAt: string(body?.updatedAt, 80) || null,
  };
}

function parseSendPilotCampaign(value: any): SendPilotCampaign | null {
  const id = string(value?.id, 240);
  const name = string(value?.name, 240);
  const status = string(value?.status, 40);
  if (!id || !name || !["started", "paused", "draft", "finished"].includes(status)) {
    return null;
  }
  return {
    id,
    name,
    status: status as SendPilotCampaign["status"],
    totalLeads: wholeNumber(value?.totalLeads),
    connectionsSent: wholeNumber(value?.connectionsSent),
    messagesSent: wholeNumber(value?.messagesSent),
    repliesReceived: wholeNumber(value?.repliesReceived),
    createdAt: string(value?.createdAt, 80) || null,
    updatedAt: string(value?.updatedAt, 80) || null,
  };
}

export async function listSendPilotCampaigns(
  apiKey: string
): Promise<SendPilotCampaign[]> {
  const campaigns: SendPilotCampaign[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const body = await sendPilotGet(
      `/v1/campaigns?status=all&page=${page}&limit=100`,
      apiKey
    );
    if (!Array.isArray(body?.campaigns)) {
      throw new SendPilotApiError("SendPilot campaign data is invalid", 502, null);
    }
    campaigns.push(
      ...body.campaigns.flatMap((value: any) => {
        const campaign = parseSendPilotCampaign(value);
        return campaign ? [campaign] : [];
      })
    );
    const totalPages = Math.max(1, wholeNumber(body?.pagination?.totalPages));
    if (page >= totalPages) break;
  }
  return campaigns;
}

export async function addSendPilotLeads(
  apiKey: string,
  input: { campaignId: string; leads: SendPilotLeadInput[] }
): Promise<SendPilotAddLeadsResult> {
  const campaignId = string(input.campaignId, 240);
  if (!campaignId || !Array.isArray(input.leads) || !input.leads.length || input.leads.length > 100) {
    throw new SendPilotApiError("A valid SendPilot campaign and up to 100 leads are required", 400, null);
  }
  const body = await sendPilotRequest("/v1/leads", apiKey, {
    method: "POST",
    body: { campaignId, leads: input.leads },
  });
  const errors = Array.isArray(body?.errors)
    ? body.errors.slice(0, 100).map((value: any) => ({
        index: Number.isInteger(value?.index) ? value.index : null,
        linkedinUrl: string(value?.linkedinUrl, 1_000) || null,
        reason: string(value?.reason, 500) || "SendPilot rejected this lead",
      }))
    : [];
  return {
    success: body?.success === true,
    leadsAdded: wholeNumber(body?.leadsAdded),
    duplicatesSkipped: wholeNumber(body?.duplicatesSkipped),
    invalidEntries: wholeNumber(body?.invalidEntries),
    errors,
  };
}

export async function updateSendPilotLeadStatus(
  apiKey: string,
  input: {
    leadId: string;
    status: "DONE" | "NOT_INTERESTED" | "MEETING_BOOKED" | "OPPORTUNITY";
    note?: string;
  }
): Promise<{ leadId: string; status: string; message: string }> {
  const leadId = string(input.leadId, 240);
  const note = string(input.note, 500);
  if (!leadId) {
    throw new SendPilotApiError("A valid SendPilot lead is required", 400, null);
  }
  const body = await sendPilotRequest(
    `/v1/leads/${encodeURIComponent(leadId)}/status`,
    apiKey,
    {
      method: "PATCH",
      body: { status: input.status, ...(note ? { note } : {}) },
    }
  );
  if (body?.success !== true || string(body?.leadId, 240) !== leadId) {
    throw new SendPilotApiError(
      "SendPilot did not confirm the lead status change",
      502,
      null
    );
  }
  return {
    leadId,
    status: string(body?.status, 80) || input.status,
    message: string(body?.message, 500) || "SendPilot lead status updated",
  };
}

export async function updateSendPilotCampaign(
  apiKey: string,
  input: { campaignId: string; action: "pause" | "resume" }
): Promise<{ campaignId: string; action: "pause" | "resume"; newStatus: string }> {
  const campaignId = string(input.campaignId, 240);
  if (!campaignId) {
    throw new SendPilotApiError("A valid SendPilot campaign is required", 400, null);
  }
  const body = await sendPilotRequest(
    `/v1/campaigns/${encodeURIComponent(campaignId)}`,
    apiKey,
    { method: "PATCH", body: { action: input.action } }
  );
  if (body?.success !== true || string(body?.campaignId, 240) !== campaignId) {
    throw new SendPilotApiError(
      "SendPilot did not confirm the campaign change",
      502,
      null
    );
  }
  return {
    campaignId,
    action: input.action,
    newStatus:
      string(body?.newStatus, 40) ||
      (input.action === "pause" ? "paused" : "started"),
  };
}

export async function listSendPilotLeads(
  apiKey: string,
  input: { campaignId: string; page?: number; limit?: number; full?: boolean }
): Promise<{ leads: SendPilotLead[]; totalPages: number }> {
  const query = new URLSearchParams({
    campaignId: input.campaignId,
    page: String(Math.max(1, input.page || 1)),
    limit: String(Math.min(100, Math.max(1, input.limit || 100))),
  });
  if (input.full) query.set("full", "true");
  const body = await sendPilotGet(`/v1/leads?${query}`, apiKey);
  if (!Array.isArray(body?.leads)) {
    throw new SendPilotApiError("SendPilot lead data is invalid", 502, null);
  }
  const leads = body.leads.flatMap((value: any) => {
    const id = string(value?.id, 240);
    const linkedinUrl = string(value?.linkedinUrl, 1_000);
    if (!id || !linkedinUrl) return [];
    return [{
      id,
      linkedinUrl,
      email: string(value?.email, 320).toLowerCase() || null,
      firstName: string(value?.firstName, 120) || null,
      lastName: string(value?.lastName, 120) || null,
      company: string(value?.company, 240) || null,
      title: string(value?.title, 240) || null,
      status: string(value?.status, 80) || null,
      customLeadStatus: string(value?.customLeadStatus, 80) || null,
      campaignId: string(value?.campaignId, 240) || undefined,
      createdAt: string(value?.createdAt, 80) || null,
      updatedAt: string(value?.updatedAt, 80) || null,
    } satisfies SendPilotLead];
  });
  return {
    leads,
    totalPages: Math.max(1, wholeNumber(body?.pagination?.totalPages)),
  };
}
