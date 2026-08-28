import "server-only";

import { createHash, randomBytes } from "crypto";
import {
  getSendPilotConversationMessages,
  getSendPilotLead,
  listSendPilotConversations,
  listSendPilotSenders,
  SendPilotApiError,
  type SendPilotConversation,
  type SendPilotMessage,
} from "@/lib/sendpilot-api";
import {
  SENDPILOT_BACKFILL_DAYS,
  SENDPILOT_BACKFILL_MAX_CONVERSATIONS,
  sendPilotMessageFingerprint,
  type SendPilotReplyEvent,
  type SendPilotWebhookEvent,
} from "@/lib/sendpilot-contract";
import {
  decryptSendPilotCredential,
  encryptSendPilotCredential,
  isSendPilotCredentialEncryptionConfigured,
} from "@/lib/sendpilot-credentials";
import {
  importLinkedInInboxBatchForScope,
  type LinkedInInboxImportResult,
} from "@/lib/linkedin-inbox";
import {
  normaliseLinkedInProfileUrl,
  normaliseStoredLinkedInProfileUrl,
} from "@/lib/linkedin-inbox-contract";
import { publicAppOrigin } from "@/lib/public-app-url";
import { supabaseService } from "@/lib/supabase";

export type SendPilotIntegrationRow = {
  id: string;
  workspace_id: string;
  owner_id: string;
  status: "active" | "disconnected";
  api_key_ciphertext: string | null;
  api_key_last_four: string | null;
  sendpilot_workspace_id: string | null;
  sender_id: string;
  sender_name: string;
  sender_linkedin_url: string;
  sender_status: string;
  webhook_path_token: string;
  webhook_secret_ciphertext: string | null;
  last_backfill_started_at: string | null;
  last_backfill_at: string | null;
  last_webhook_at: string | null;
  last_error: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

type OwnerScope = { userId: string; workspaceId: string };

type IncomingSendPilotMessage = {
  direction: "inbound";
  conversationId: string;
  messageId: string;
  senderName: string;
  senderProfileUrl: string;
  body: string;
  receivedAt: string;
};

const INTEGRATION_SELECT =
  "id,workspace_id,owner_id,status,api_key_ciphertext,api_key_last_four,sendpilot_workspace_id,sender_id,sender_name,sender_linkedin_url,sender_status,webhook_path_token,webhook_secret_ciphertext,last_backfill_started_at,last_backfill_at,last_webhook_at,last_error,disconnected_at,created_at,updated_at";

const safeError = (error: any) =>
  String(error?.message || "SendPilot inbox integration failed").slice(0, 500);

const integrationCredentialScope = (
  integration: Pick<SendPilotIntegrationRow, "owner_id" | "workspace_id">,
  purpose: "api-key" | "webhook-secret"
) => ({
  ownerId: integration.owner_id,
  workspaceId: integration.workspace_id,
  purpose,
});

export async function loadSendPilotIntegrationForOwner(
  scope: OwnerScope
): Promise<SendPilotIntegrationRow | null> {
  const { data, error } = await supabaseService
    .from("sendpilot_integrations")
    .select(INTEGRATION_SELECT)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .maybeSingle();
  if (error) throw error;
  return (data as SendPilotIntegrationRow | null) || null;
}

export async function loadSendPilotIntegrationByWebhookToken(
  token: string
): Promise<SendPilotIntegrationRow | null> {
  if (!/^spwh_[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const { data, error } = await supabaseService
    .from("sendpilot_integrations")
    .select(INTEGRATION_SELECT)
    .eq("webhook_path_token", token)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return (data as SendPilotIntegrationRow | null) || null;
}

export function decryptSendPilotApiKey(integration: SendPilotIntegrationRow): string {
  if (!integration.api_key_ciphertext) {
    throw new Error("SendPilot is not connected");
  }
  return decryptSendPilotCredential(
    integration.api_key_ciphertext,
    integrationCredentialScope(integration, "api-key")
  );
}

export function decryptSendPilotWebhookSecret(
  integration: SendPilotIntegrationRow
): string {
  if (!integration.webhook_secret_ciphertext) {
    throw new Error("SendPilot webhook verification is not configured");
  }
  return decryptSendPilotCredential(
    integration.webhook_secret_ciphertext,
    integrationCredentialScope(integration, "webhook-secret")
  );
}

export function sendPilotWebhookUrl(integration: SendPilotIntegrationRow): string {
  return `${publicAppOrigin()}/api/webhooks/sendpilot/${integration.webhook_path_token}`;
}

export async function sendPilotIntegrationStatus(scope: OwnerScope) {
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration) {
    return {
      configured: isSendPilotCredentialEncryptionConfigured(),
      connected: false,
      status: "not_connected" as const,
      apiKeyLastFour: null,
      senderName: null,
      senderLinkedInUrl: null,
      senderStatus: null,
      webhookConfigured: false,
      webhookUrl: null,
      lastBackfillAt: null,
      lastWebhookAt: null,
      lastError: null,
      importedMessageCount: 0,
      reviewCount: 0,
      lookbackDays: SENDPILOT_BACKFILL_DAYS,
      mappedCampaignCount: 0,
      activeLeadCount: 0,
      outboundReady: false,
    };
  }
  const baseQuery = () => supabaseService
    .from("linkedin_inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .contains("metadata", { provider: "sendpilot" });
  const [
    { count: importedMessageCount, error: countError },
    reviewResult,
    mappingResult,
    activeLeadResult,
  ] =
    await Promise.all([
      baseQuery(),
      baseQuery().eq("status", "review"),
      supabaseService
        .from("sendpilot_campaign_links")
        .select("id", { count: "exact", head: true })
        .eq("integration_id", integration.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("active", true),
      supabaseService
        .from("sendpilot_lead_links")
        .select("id", { count: "exact", head: true })
        .eq("integration_id", integration.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .in("sync_status", [
          "submitting",
          "pending_confirmation",
          "queued",
          "active",
          "replied",
        ]),
    ]);
  if (countError) throw countError;
  if (reviewResult.error) throw reviewResult.error;
  if (mappingResult.error) throw mappingResult.error;
  if (activeLeadResult.error) throw activeLeadResult.error;
  const connected = integration.status === "active" && !!integration.api_key_ciphertext;
  return {
    configured: isSendPilotCredentialEncryptionConfigured(),
    connected,
    status: integration.status,
    apiKeyLastFour: integration.api_key_last_four,
    senderName: integration.sender_name,
    senderLinkedInUrl: integration.sender_linkedin_url,
    senderStatus: integration.sender_status,
    webhookConfigured: connected && !!integration.webhook_secret_ciphertext,
    webhookUrl: connected ? sendPilotWebhookUrl(integration) : null,
    lastBackfillAt: integration.last_backfill_at,
    lastWebhookAt: integration.last_webhook_at,
    lastError: integration.last_error,
    importedMessageCount: importedMessageCount || 0,
    reviewCount: reviewResult.count || 0,
    lookbackDays: SENDPILOT_BACKFILL_DAYS,
    mappedCampaignCount: mappingResult.count || 0,
    activeLeadCount: activeLeadResult.count || 0,
    outboundReady:
      connected &&
      !!integration.webhook_secret_ciphertext &&
      (mappingResult.count || 0) > 0,
  };
}

export async function connectSendPilot(
  scope: OwnerScope,
  apiKeyInput: unknown,
  requestedSenderId?: unknown
): Promise<SendPilotIntegrationRow> {
  if (!isSendPilotCredentialEncryptionConfigured()) {
    throw Object.assign(
      new Error("SendPilot credential encryption is not configured"),
      { status: 503 }
    );
  }
  const apiKey = typeof apiKeyInput === "string" ? apiKeyInput.trim() : "";
  if (apiKey.length < 20 || apiKey.length > 500 || /\s/.test(apiKey)) {
    throw Object.assign(new Error("A valid SendPilot API key is required"), {
      status: 400,
    });
  }
  const senders = await listSendPilotSenders(apiKey);
  const activeSenders = senders.filter((sender) => sender.status === "active");
  const requested = typeof requestedSenderId === "string"
    ? requestedSenderId.trim()
    : "";
  const sender = requested
    ? activeSenders.find((candidate) => candidate.id === requested)
    : activeSenders.length === 1
      ? activeSenders[0]
      : null;
  if (!sender) {
    const message = activeSenders.length > 1
      ? "Choose which active SendPilot LinkedIn account belongs to this LiveCoach user"
      : "SendPilot does not have an active LinkedIn account for this workspace";
    throw Object.assign(new Error(message), { status: 409 });
  }
  const linkedinUrl = normaliseLinkedInProfileUrl(sender.linkedinUrl);
  if (!linkedinUrl) {
    throw Object.assign(
      new Error("SendPilot returned an invalid LinkedIn account identity"),
      { status: 502 }
    );
  }
  const existing = await loadSendPilotIntegrationForOwner(scope);
  const now = new Date().toISOString();
  const values = {
    workspace_id: scope.workspaceId,
    owner_id: scope.userId,
    visibility: "private",
    status: "active",
    api_key_ciphertext: encryptSendPilotCredential(apiKey, {
      ownerId: scope.userId,
      workspaceId: scope.workspaceId,
      purpose: "api-key",
    }),
    api_key_last_four: apiKey.slice(-4),
    sender_id: sender.id,
    sender_name: sender.name,
    sender_linkedin_url: linkedinUrl,
    sender_status: sender.status,
    webhook_path_token:
      existing?.webhook_path_token || `spwh_${randomBytes(36).toString("base64url")}`,
    sendpilot_workspace_id: null,
    webhook_secret_ciphertext: null,
    disconnected_at: null,
    last_error: null,
    updated_at: now,
  };
  const query = existing
    ? supabaseService
        .from("sendpilot_integrations")
        .update(values)
        .eq("id", existing.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
    : supabaseService.from("sendpilot_integrations").insert(values);
  const { data, error } = await query.select(INTEGRATION_SELECT).single();
  if (error) throw error;
  await writeSendPilotAudit(scope, {
    action: existing ? "sendpilot_integration_reconnected" : "sendpilot_integration_connected",
    targetId: data.id,
    previous: existing ? { status: existing.status, sender_id: existing.sender_id } : {},
    next: { status: "active", sender_id: sender.id, webhook_configured: !!data.webhook_secret_ciphertext },
  });
  return data as SendPilotIntegrationRow;
}

export async function configureSendPilotWebhookSecret(
  scope: OwnerScope,
  value: unknown
): Promise<SendPilotIntegrationRow> {
  const secret = typeof value === "string" ? value.trim() : "";
  if (secret.length < 16 || secret.length > 500 || /\s/.test(secret)) {
    throw Object.assign(new Error("A valid SendPilot webhook secret is required"), {
      status: 400,
    });
  }
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration || integration.status !== "active") {
    throw Object.assign(new Error("Connect SendPilot before configuring its webhook"), {
      status: 409,
    });
  }
  const now = new Date().toISOString();
  const { data, error } = await supabaseService
    .from("sendpilot_integrations")
    .update({
      webhook_secret_ciphertext: encryptSendPilotCredential(
        secret,
        integrationCredentialScope(integration, "webhook-secret")
      ),
      last_error: null,
      updated_at: now,
    })
    .eq("id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .select(INTEGRATION_SELECT)
    .single();
  if (error) throw error;
  await writeSendPilotAudit(scope, {
    action: "sendpilot_webhook_secret_configured",
    targetId: integration.id,
    previous: { webhook_configured: !!integration.webhook_secret_ciphertext },
    next: { webhook_configured: true },
  });
  return data as SendPilotIntegrationRow;
}

export async function disconnectSendPilot(scope: OwnerScope) {
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration || integration.status === "disconnected") return;
  const now = new Date().toISOString();
  const [integrationUpdate, mappingUpdate] = await Promise.all([
    supabaseService
      .from("sendpilot_integrations")
      .update({
        status: "disconnected",
        api_key_ciphertext: null,
        api_key_last_four: null,
        webhook_secret_ciphertext: null,
        disconnected_at: now,
        updated_at: now,
      })
      .eq("id", integration.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId),
    supabaseService
      .from("sendpilot_campaign_links")
      .update({ active: false, updated_at: now })
      .eq("integration_id", integration.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId),
  ]);
  if (integrationUpdate.error) throw integrationUpdate.error;
  if (mappingUpdate.error) throw mappingUpdate.error;
  await writeSendPilotAudit(scope, {
    action: "sendpilot_integration_disconnected",
    targetId: integration.id,
    previous: { status: "active", webhook_configured: !!integration.webhook_secret_ciphertext },
    next: { status: "disconnected", webhook_configured: false },
  });
}

function batchRunId(prefix: string) {
  return `${prefix}_${Date.now()}_${randomBytes(8).toString("hex")}`;
}

function messagePartyForConversation(
  conversation: SendPilotConversation,
  message: SendPilotMessage
) {
  const directUrl = normaliseLinkedInProfileUrl(message.sender?.profileUrl);
  if (directUrl) {
    return { profileUrl: directUrl, name: String(message.sender?.name || "").trim() };
  }
  for (const participant of conversation.participants) {
    const profileUrl = normaliseLinkedInProfileUrl(participant.profileUrl);
    if (profileUrl) {
      return { profileUrl, name: String(participant.name || "").trim() };
    }
  }
  return null;
}

function chunkSendPilotMessages(
  messages: IncomingSendPilotMessage[]
): IncomingSendPilotMessage[][] {
  const chunks: IncomingSendPilotMessage[][] = [];
  let current: IncomingSendPilotMessage[] = [];
  let conversations = new Set<string>();
  for (const message of messages) {
    const addsConversation = !conversations.has(message.conversationId);
    if (
      current.length >= 200 ||
      (addsConversation && conversations.size >= 20)
    ) {
      chunks.push(current);
      current = [];
      conversations = new Set<string>();
    }
    current.push(message);
    conversations.add(message.conversationId);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function runSendPilotBackfill(
  scope: OwnerScope
): Promise<LinkedInInboxImportResult & { conversations: number; truncated: boolean }> {
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration || integration.status !== "active") {
    throw Object.assign(new Error("SendPilot is not connected"), { status: 409 });
  }
  const startedAt = new Date().toISOString();
  const claimCutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: claimed, error: claimError } = await supabaseService
    .from("sendpilot_integrations")
    .update({ last_backfill_started_at: startedAt, last_error: null, updated_at: startedAt })
    .eq("id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("status", "active")
    .or(`last_backfill_started_at.is.null,last_backfill_started_at.lt.${claimCutoff}`)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw Object.assign(new Error("A SendPilot backfill is already running"), {
      status: 429,
    });
  }

  try {
    const apiKey = decryptSendPilotApiKey(integration);
    const cutoffMs = Date.now() - SENDPILOT_BACKFILL_DAYS * 24 * 60 * 60 * 1_000;
    const conversations: SendPilotConversation[] = [];
    let continuationToken: string | null = null;
    let hasMore = false;
    do {
      const page = await listSendPilotConversations(apiKey, {
        accountId: integration.sender_id,
        continuationToken,
        limit: Math.min(100, SENDPILOT_BACKFILL_MAX_CONVERSATIONS - conversations.length),
      });
      conversations.push(
        ...page.conversations.filter(
          (conversation) => conversation.accountId === integration.sender_id
        )
      );
      continuationToken = page.continuationToken;
      hasMore = page.hasMore;
    } while (
      hasMore &&
      continuationToken &&
      conversations.length < SENDPILOT_BACKFILL_MAX_CONVERSATIONS
    );

    const incoming: IncomingSendPilotMessage[] = [];
    for (const conversation of conversations) {
      const activityMs = new Date(conversation.lastActivityAt || "").getTime();
      if (Number.isFinite(activityMs) && activityMs < cutoffMs) continue;
      let messageToken: string | null = null;
      let messagePages = 0;
      do {
        const page = await getSendPilotConversationMessages(apiKey, {
          accountId: integration.sender_id,
          conversationId: conversation.id,
          continuationToken: messageToken,
          limit: 100,
        });
        messagePages += 1;
        for (const message of page.messages) {
          if (message.direction !== "received") continue;
          const receivedMs = new Date(message.sentAt).getTime();
          if (!Number.isFinite(receivedMs) || receivedMs < cutoffMs) continue;
          const party = messagePartyForConversation(conversation, message);
          if (!party?.profileUrl || !party.name || !message.content.trim()) continue;
          const receivedAt = new Date(receivedMs).toISOString();
          incoming.push({
            direction: "inbound",
            conversationId: conversation.id,
            messageId: sendPilotMessageFingerprint({
              senderProfileUrl: party.profileUrl,
              receivedAt,
              body: message.content,
            }),
            senderName: party.name,
            senderProfileUrl: party.profileUrl,
            body: message.content,
            receivedAt,
          });
        }
        messageToken = page.continuationToken;
        if (!page.hasMore || !messageToken || messagePages >= 5) break;
      } while (true);
    }

    incoming.sort(
      (left, right) =>
        new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime()
    );
    const total: LinkedInInboxImportResult = {
      runId: batchRunId("sendpilot_backfill"),
      accepted: 0,
      imported: 0,
      duplicates: 0,
      linked: 0,
      review: 0,
      contactsCreated: 0,
    };
    const chunks = chunkSendPilotMessages(incoming);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const result = await importLinkedInInboxBatchForScope(
        {
          workspaceId: scope.workspaceId,
          ownerId: scope.userId,
          connectorId: null,
          maxConversations: 20,
          lookbackDays: SENDPILOT_BACKFILL_DAYS,
          source: "sendpilot_api",
          provider: "sendpilot",
          contactSource: "sendpilot_inbox",
          createContactWhenUnmatched: true,
        },
        {
          runId: `${total.runId}_${index}`,
          capturedAt: new Date().toISOString(),
          conversationCount: new Set(chunk.map((message) => message.conversationId)).size,
          messages: chunk,
        }
      );
      total.accepted += result.accepted;
      total.imported += result.imported;
      total.duplicates += result.duplicates;
      total.linked += result.linked;
      total.review += result.review;
      total.contactsCreated += result.contactsCreated;
      const providerMessageIds = chunk.map((message) => message.messageId);
      const { data: linkedMessages, error: linkedMessagesError } = await supabaseService
        .from("linkedin_inbox_messages")
        .select("id,provider_message_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .in("provider_message_id", providerMessageIds);
      if (linkedMessagesError) throw linkedMessagesError;
      const inboxMessageByProviderId = new Map(
        (linkedMessages || []).map((message: any) => [message.provider_message_id, message.id])
      );
      const { recordSendPilotBackfillReplyInCrm } = await import(
        "@/lib/sendpilot-outreach"
      );
      for (const message of chunk) {
        await recordSendPilotBackfillReplyInCrm(
          integration,
          message,
          inboxMessageByProviderId.get(message.messageId) || null
        );
      }
    }

    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabaseService
      .from("sendpilot_integrations")
      .update({ last_backfill_at: completedAt, last_error: null, updated_at: completedAt })
      .eq("id", integration.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    if (updateError) throw updateError;
    await writeSendPilotAudit(scope, {
      action: "sendpilot_inbox_backfilled",
      targetId: integration.id,
      previous: {},
      next: {
        lookback_days: SENDPILOT_BACKFILL_DAYS,
        conversations: conversations.length,
        accepted: total.accepted,
        imported: total.imported,
        duplicates: total.duplicates,
        review: total.review,
      },
    });
    return {
      ...total,
      conversations: conversations.length,
      truncated:
        hasMore && conversations.length >= SENDPILOT_BACKFILL_MAX_CONVERSATIONS,
    };
  } catch (error: any) {
    const message = safeError(error);
    await supabaseService
      .from("sendpilot_integrations")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", integration.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    throw error;
  }
}

async function knownLinkedInName(
  integration: SendPilotIntegrationRow,
  profileUrl: string
): Promise<string | null> {
  const { data: link, error: linkError } = await supabaseService
    .from("linkedin_contact_links")
    .select("contact_id")
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .eq("sender_profile_url", profileUrl)
    .maybeSingle();
  if (linkError) throw linkError;
  if (link?.contact_id) {
    const { data: contact, error: contactError } = await supabaseService
      .from("contacts")
      .select("name")
      .eq("id", link.contact_id)
      .eq("workspace_id", integration.workspace_id)
      .eq("owner_id", integration.owner_id)
      .maybeSingle();
    if (contactError) throw contactError;
    const contactName = String(contact?.name || "").trim();
    if (contactName) return contactName;
  }

  const profilePath = new URL(profileUrl).pathname;
  const escapedPath = profilePath.replace(/[\\%_]/g, (value) => `\\${value}`);
  const { data: prospects, error: prospectError } = await supabaseService
    .from("outreach_prospects")
    .select("first_name,last_name,person_linkedin_url")
    .eq("workspace_id", integration.workspace_id)
    .eq("assigned_to_user_id", integration.owner_id)
    .ilike("person_linkedin_url", `%${escapedPath}%`)
    .limit(100);
  if (prospectError) throw prospectError;
  const names = [
    ...new Set(
      (prospects || [])
        .filter(
          (prospect: any) =>
            normaliseStoredLinkedInProfileUrl(prospect.person_linkedin_url) === profileUrl
        )
        .map((prospect: any) =>
          [prospect.first_name, prospect.last_name]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(" ")
        )
        .filter(Boolean)
    ),
  ];
  return names.length === 1 ? names[0] : null;
}

export async function processSendPilotWebhookEvent(
  integration: SendPilotIntegrationRow,
  receiptId: string,
  event: SendPilotWebhookEvent
): Promise<void> {
  try {
    if (
      event.eventType !== "lead.updated" &&
      event.data.senderId !== integration.sender_id
    ) {
      await finishWebhookReceipt(receiptId, integration, {
        status: "ignored",
        error: "The event belongs to a different LinkedIn sender",
      });
      return;
    }
    const profileUrl = normaliseLinkedInProfileUrl(event.data.linkedinUrl);
    if (!profileUrl) throw new Error("SendPilot event has an invalid LinkedIn identity");
    let linkedInboxMessageId: string | null = null;
    let leadLinkId: string | null = null;
    let outreachEventId: string | null = null;

    if (event.eventType === "reply.received") {
      const apiKey = decryptSendPilotApiKey(integration);
      let senderName = "";
      try {
        const lead = await getSendPilotLead(apiKey, event.data.leadId);
        const leadUrl = normaliseLinkedInProfileUrl(lead.linkedinUrl);
        if (leadUrl === profileUrl) {
          senderName = [lead.firstName, lead.lastName]
            .filter(Boolean)
            .join(" ")
            .trim();
        }
      } catch (error) {
        if (!(error instanceof SendPilotApiError)) throw error;
      }
      if (!senderName) {
        senderName = (await knownLinkedInName(integration, profileUrl)) || "";
      }
      const receivedAt = event.timestamp;
      const messageId = sendPilotMessageFingerprint({
        senderProfileUrl: profileUrl,
        receivedAt,
        body: event.data.reply,
      });
      const result = await importLinkedInInboxBatchForScope(
        {
          workspaceId: integration.workspace_id,
          ownerId: integration.owner_id,
          connectorId: null,
          maxConversations: 1,
          lookbackDays: SENDPILOT_BACKFILL_DAYS,
          source: "sendpilot_webhook",
          provider: "sendpilot",
          contactSource: "sendpilot_inbox",
          createContactWhenUnmatched: !!senderName,
        },
        {
          runId: `sendpilot_${event.eventId.replace(/[^a-z0-9_-]/gi, "_")}`.slice(0, 120),
          capturedAt: new Date().toISOString(),
          conversationCount: 1,
          messages: [{
            direction: "inbound",
            conversationId: `sendpilot:${event.data.senderId}:${event.data.leadId}`,
            messageId,
            senderName: senderName || "LinkedIn contact",
            senderProfileUrl: profileUrl,
            body: event.data.reply,
            receivedAt,
          }],
        }
      );
      const { data: message, error: messageError } = await supabaseService
        .from("linkedin_inbox_messages")
        .select("id")
        .eq("workspace_id", integration.workspace_id)
        .eq("owner_id", integration.owner_id)
        .eq("provider_message_id", messageId)
        .maybeSingle();
      if (messageError) throw messageError;
      linkedInboxMessageId = message?.id || null;
      if (result.accepted) {
        const { recordSendPilotReplyInCrm } = await import(
          "@/lib/sendpilot-outreach"
        );
        const crm = await recordSendPilotReplyInCrm(
          integration,
          event,
          linkedInboxMessageId,
          messageId
        );
        leadLinkId = crm.leadLinkId;
        outreachEventId = crm.outreachEventId;
      }
      await finishWebhookReceipt(receiptId, integration, {
        status: result.accepted ? "processed" : "ignored",
        linkedInboxMessageId,
        sendPilotLeadLinkId: leadLinkId,
        linkedOutreachEventId: outreachEventId,
        error: result.accepted ? null : "The reply is outside the 14-day import window",
      });
    } else {
      const { recordSendPilotOperationalEvent } = await import(
        "@/lib/sendpilot-outreach"
      );
      const crm = await recordSendPilotOperationalEvent(integration, event);
      leadLinkId = crm.leadLinkId;
      outreachEventId = crm.outreachEventId;
      await finishWebhookReceipt(receiptId, integration, {
        status: leadLinkId ? "processed" : "ignored",
        sendPilotLeadLinkId: leadLinkId,
        linkedOutreachEventId: outreachEventId,
        error: leadLinkId
          ? null
          : "The event could not be matched to this salesperson's CRM lead",
      });
    }
    const now = new Date().toISOString();
    await supabaseService
      .from("sendpilot_integrations")
      .update({ last_webhook_at: now, last_error: null, updated_at: now })
      .eq("id", integration.id)
      .eq("workspace_id", integration.workspace_id)
      .eq("owner_id", integration.owner_id);
  } catch (error: any) {
    const message = safeError(error);
    await finishWebhookReceipt(receiptId, integration, {
      status: "failed",
      error: message,
    });
    await supabaseService
      .from("sendpilot_integrations")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", integration.id)
      .eq("workspace_id", integration.workspace_id)
      .eq("owner_id", integration.owner_id);
    console.error("SendPilot webhook processing failed", message);
  }
}

export async function processSendPilotReplyEvent(
  integration: SendPilotIntegrationRow,
  receiptId: string,
  event: SendPilotReplyEvent
): Promise<void> {
  return processSendPilotWebhookEvent(integration, receiptId, event);
}

export async function bindSendPilotWorkspace(
  integration: SendPilotIntegrationRow,
  workspaceId: string
): Promise<boolean> {
  if (integration.sendpilot_workspace_id) {
    return integration.sendpilot_workspace_id === workspaceId;
  }
  const { data, error } = await supabaseService
    .from("sendpilot_integrations")
    .update({ sendpilot_workspace_id: workspaceId, updated_at: new Date().toISOString() })
    .eq("id", integration.id)
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .is("sendpilot_workspace_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (data) return true;
  const refreshed = await loadSendPilotIntegrationForOwner({
    userId: integration.owner_id,
    workspaceId: integration.workspace_id,
  });
  return refreshed?.sendpilot_workspace_id === workspaceId;
}

export async function createSendPilotWebhookReceipt(
  integration: SendPilotIntegrationRow,
  event: SendPilotWebhookEvent,
  rawBody: string
): Promise<{ id: string | null; duplicate: boolean }> {
  const payloadDigest = createHash("sha256").update(rawBody).digest("hex");
  const { data, error } = await supabaseService
    .from("sendpilot_webhook_events")
    .insert({
      integration_id: integration.id,
      workspace_id: integration.workspace_id,
      owner_id: integration.owner_id,
      visibility: "private",
      provider_event_id: event.eventId,
      event_type: event.eventType,
      provider_timestamp: event.timestamp,
      status: "received",
      payload_digest: payloadDigest,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    // SendPilot retries deliveries. A receipt that is still being processed or
    // has completed is a duplicate. A failed receipt may be claimed exactly
    // once for another attempt, but only when the signed payload is identical.
    const now = new Date().toISOString();
    const { data: retry, error: retryError } = await supabaseService
      .from("sendpilot_webhook_events")
      .update({
        status: "received",
        error: null,
        processed_at: null,
        updated_at: now,
      })
      .eq("integration_id", integration.id)
      .eq("workspace_id", integration.workspace_id)
      .eq("owner_id", integration.owner_id)
      .eq("provider_event_id", event.eventId)
      .eq("payload_digest", payloadDigest)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (retryError) throw retryError;
    return retry
      ? { id: retry.id, duplicate: false }
      : { id: null, duplicate: true };
  }
  if (error) throw error;
  return { id: data.id, duplicate: false };
}

async function finishWebhookReceipt(
  receiptId: string,
  integration: SendPilotIntegrationRow,
  input: {
    status: "processed" | "ignored" | "failed";
    linkedInboxMessageId?: string | null;
    sendPilotLeadLinkId?: string | null;
    linkedOutreachEventId?: string | null;
    error?: string | null;
  }
) {
  const now = new Date().toISOString();
  const { error } = await supabaseService
    .from("sendpilot_webhook_events")
    .update({
      status: input.status,
      linked_inbox_message_id: input.linkedInboxMessageId || null,
      sendpilot_lead_link_id: input.sendPilotLeadLinkId || null,
      linked_outreach_event_id: input.linkedOutreachEventId || null,
      error: input.error || null,
      processed_at: now,
      updated_at: now,
    })
    .eq("id", receiptId)
    .eq("integration_id", integration.id)
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id);
  if (error) throw error;
}

async function writeSendPilotAudit(
  scope: OwnerScope,
  input: {
    action: string;
    targetId: string;
    previous: Record<string, unknown>;
    next: Record<string, unknown>;
  }
) {
  const { error } = await supabaseService.from("access_audit_events").insert({
    workspace_id: scope.workspaceId,
    actor_user_id: scope.userId,
    source: "system",
    action: input.action,
    target_table: "sendpilot_integrations",
    target_id: input.targetId,
    previous_scope: input.previous,
    next_scope: input.next,
  });
  if (error) console.error("SendPilot audit failed", error.message);
}
