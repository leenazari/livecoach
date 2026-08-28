import "server-only";

import { createHash, randomBytes } from "crypto";
import { supabaseService } from "@/lib/supabase";
import {
  LINKEDIN_INBOX_MAX_MESSAGES_PER_24_HOURS,
  normaliseLinkedInProfileUrl,
  normaliseStoredLinkedInProfileUrl,
  parseLinkedInInboxBatch,
  type LinkedInInboxBatch,
  type LinkedInInboxMessageInput,
} from "@/lib/linkedin-inbox-contract";

export type LinkedInInboxConnectorRow = {
  id: string;
  workspace_id: string;
  owner_id: string;
  status: "active" | "revoked";
  token_last_four: string;
  extension_origin: string | null;
  max_conversations_per_run: number;
  lookback_days: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  imported_message_count: number;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LinkedInInboxImportScope = {
  workspaceId: string;
  ownerId: string;
  connectorId?: string | null;
  maxConversations: number;
  lookbackDays: number;
  source: "local_chrome_extension" | "sendpilot_api" | "sendpilot_webhook";
  provider: "linkedin_local_connector" | "sendpilot";
  contactSource: "linkedin_inbox_connector" | "sendpilot_inbox";
  createContactWhenUnmatched: boolean;
};

type LinkedInInboxIdentityScope = {
  workspace_id: string;
  owner_id: string;
  contactSource: LinkedInInboxImportScope["contactSource"];
};

type ImportIdentity = {
  contactId: string | null;
  companyId: string | null;
  reviewReason: string | null;
  contactCreated: boolean;
};

type OutreachProspectMatch = {
  email: string;
  crm_company_id: string | null;
  identityAmbiguous: boolean;
  companyAmbiguous: boolean;
};

type ContactMatch = {
  contact: { id: string; company_id: string | null; email: string } | null;
  ambiguous: boolean;
};

export type LinkedInInboxImportResult = {
  runId: string;
  accepted: number;
  imported: number;
  duplicates: number;
  linked: number;
  review: number;
  contactsCreated: number;
};

const CONNECTOR_SELECT =
  "id,workspace_id,owner_id,status,token_last_four,extension_origin,max_conversations_per_run,lookback_days,last_run_at,last_success_at,last_error,imported_message_count,revoked_at,created_at,updated_at";

export function generateLinkedInInboxToken(): string {
  return `lci_${randomBytes(32).toString("base64url")}`;
}

export function hashLinkedInInboxToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseLinkedInInboxBearer(value: string | null): string | null {
  const match = String(value || "").match(/^Bearer\s+(lci_[A-Za-z0-9_-]{40,80})$/);
  return match?.[1] || null;
}

export function chromeExtensionOriginFromId(value: string | null): string | null {
  const id = String(value || "");
  return /^[a-p]{32}$/.test(id) ? `chrome-extension://${id}` : null;
}

export async function loadLinkedInInboxConnectorForOwner(scope: {
  userId: string;
  workspaceId: string;
}): Promise<LinkedInInboxConnectorRow | null> {
  const { data, error } = await supabaseService
    .from("linkedin_inbox_connectors")
    .select(CONNECTOR_SELECT)
    .eq("owner_id", scope.userId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as LinkedInInboxConnectorRow | null) || null;
}

export async function authenticateLinkedInInboxConnector(
  authorization: string | null
): Promise<LinkedInInboxConnectorRow | null> {
  const token = parseLinkedInInboxBearer(authorization);
  if (!token) return null;
  const tokenHash = hashLinkedInInboxToken(token);
  const { data, error } = await supabaseService
    .from("linkedin_inbox_connectors")
    .select(CONNECTOR_SELECT)
    .eq("token_hash", tokenHash)
    .eq("status", "active")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as LinkedInInboxConnectorRow | null) || null;
}

export async function bindLinkedInInboxExtensionOrigin(
  connector: LinkedInInboxConnectorRow,
  origin: string
): Promise<LinkedInInboxConnectorRow> {
  if (connector.extension_origin && connector.extension_origin !== origin) {
    throw new Error("This connector key is already bound to another browser extension");
  }
  if (connector.extension_origin === origin) return connector;
  const { data, error } = await supabaseService
    .from("linkedin_inbox_connectors")
    .update({ extension_origin: origin, updated_at: new Date().toISOString() })
    .eq("id", connector.id)
    .eq("owner_id", connector.owner_id)
    .eq("workspace_id", connector.workspace_id)
    .is("extension_origin", null)
    .select(CONNECTOR_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as LinkedInInboxConnectorRow;

  const refreshed = await authenticateLinkedInInboxConnectorById(connector.id);
  if (!refreshed || refreshed.extension_origin !== origin) {
    throw new Error("This connector key is already bound to another browser extension");
  }
  return refreshed;
}

async function authenticateLinkedInInboxConnectorById(
  connectorId: string
): Promise<LinkedInInboxConnectorRow | null> {
  const { data, error } = await supabaseService
    .from("linkedin_inbox_connectors")
    .select(CONNECTOR_SELECT)
    .eq("id", connectorId)
    .eq("status", "active")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as LinkedInInboxConnectorRow | null) || null;
}

function normalisedStoredLinkedInUrl(value: unknown) {
  return normaliseStoredLinkedInProfileUrl(value);
}

async function loadExactOutreachProspect(
  connector: LinkedInInboxIdentityScope,
  profileUrl: string
): Promise<OutreachProspectMatch | null> {
  const profilePath = new URL(profileUrl).pathname;
  const escapedPath = profilePath.replace(/[\\%_]/g, (value) => `\\${value}`);
  const { data, error } = await supabaseService
    .from("outreach_prospects")
    .select("id,first_name,last_name,email,crm_company_id,person_linkedin_url")
    .eq("workspace_id", connector.workspace_id)
    .eq("assigned_to_user_id", connector.owner_id)
    .ilike("person_linkedin_url", `%${escapedPath}%`)
    .limit(100);
  if (error) throw error;
  const exact = (data || []).filter(
    (row: any) =>
      normalisedStoredLinkedInUrl(row.person_linkedin_url) === profileUrl
  );
  if (!exact.length) return null;

  const emails = [
    ...new Set(
      exact
        .map((row: any) => String(row.email || "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const companyIds = [
    ...new Set(
      exact.map((row: any) => String(row.crm_company_id || "")).filter(Boolean)
    ),
  ];
  return {
    email: emails.length === 1 ? emails[0] : "",
    crm_company_id: companyIds.length === 1 ? companyIds[0] : null,
    identityAmbiguous: emails.length > 1,
    companyAmbiguous: companyIds.length > 1,
  };
}

async function loadExactContactByEmail(
  connector: LinkedInInboxIdentityScope,
  email: string
): Promise<ContactMatch> {
  if (!email) return { contact: null, ambiguous: false };
  const escaped = email.replace(/[\\%_]/g, (value) => `\\${value}`);
  const { data, error } = await supabaseService
    .from("contacts")
    .select("id,company_id,email")
    .eq("workspace_id", connector.workspace_id)
    .eq("owner_id", connector.owner_id)
    .ilike("email", escaped)
    .limit(3);
  if (error) throw error;
  const exact = (data || []).filter(
    (row: any) => String(row.email || "").trim().toLowerCase() === email
  );
  return {
    contact: exact.length === 1 ? exact[0] : null,
    ambiguous: exact.length > 1,
  };
}

async function loadOwnedCompanyId(
  connector: LinkedInInboxIdentityScope,
  companyId: unknown
): Promise<string | null> {
  const id = String(companyId || "");
  if (!id) return null;
  const { data, error } = await supabaseService
    .from("companies")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", connector.workspace_id)
    .eq("owner_id", connector.owner_id)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function resolveLinkedInIdentity(
  connector: LinkedInInboxIdentityScope,
  profileUrl: string,
  senderName: string,
  createContactWhenUnmatched: boolean
): Promise<ImportIdentity> {
  const { data: existingLink, error: linkError } = await supabaseService
    .from("linkedin_contact_links")
    .select("contact_id")
    .eq("workspace_id", connector.workspace_id)
    .eq("owner_id", connector.owner_id)
    .eq("sender_profile_url", profileUrl)
    .maybeSingle();
  if (linkError) throw linkError;

  if (existingLink?.contact_id) {
    const { data: contact, error: contactError } = await supabaseService
      .from("contacts")
      .select("id,company_id")
      .eq("id", existingLink.contact_id)
      .eq("workspace_id", connector.workspace_id)
      .eq("owner_id", connector.owner_id)
      .maybeSingle();
    if (contactError) throw contactError;
    if (contact) {
      const companyId = await loadOwnedCompanyId(connector, contact.company_id);
      return {
        contactId: contact.id,
        companyId,
        reviewReason: companyId
          ? null
          : contact.company_id
            ? "company_outside_owner_scope"
            : "company_not_verified",
        contactCreated: false,
      };
    }
  }

  const prospect = await loadExactOutreachProspect(connector, profileUrl);
  if (prospect?.identityAmbiguous) {
    return {
      contactId: null,
      companyId: null,
      reviewReason: "outreach_identity_ambiguous",
      contactCreated: false,
    };
  }
  const prospectEmail = prospect?.email || "";
  const contactMatch = prospectEmail
    ? await loadExactContactByEmail(connector, prospectEmail)
    : { contact: null, ambiguous: false };
  if (contactMatch.ambiguous) {
    return {
      contactId: null,
      companyId: null,
      reviewReason: "duplicate_crm_contacts",
      contactCreated: false,
    };
  }
  const existingContact = contactMatch.contact;
  const prospectCompanyId = await loadOwnedCompanyId(
    connector,
    prospect?.crm_company_id
  );
  const existingContactCompanyId = await loadOwnedCompanyId(
    connector,
    existingContact?.company_id
  );

  let contactId = existingContact?.id || null;
  let companyId = existingContact ? existingContactCompanyId : prospectCompanyId;
  let contactCreated = false;
  if (!contactId && !createContactWhenUnmatched) {
    return {
      contactId: null,
      companyId: null,
      reviewReason: "sender_name_not_verified",
      contactCreated: false,
    };
  }
  if (!contactId) {
    const { data: created, error: createError } = await supabaseService
      .from("contacts")
      .insert({
        workspace_id: connector.workspace_id,
        owner_id: connector.owner_id,
        visibility: "private",
        company_id: companyId,
        name: senderName,
        email: prospectEmail || null,
        attributes: {
          linkedin_url: profileUrl,
          source: connector.contactSource,
        },
        notes: companyId
          ? "Matched to an existing outreach lead by exact LinkedIn profile URL."
          : "Imported from LinkedIn inbox. Company is intentionally unassigned until verified.",
      })
      .select("id,company_id")
      .single();
    if (createError) throw createError;
    contactId = created.id;
    companyId = created.company_id || null;
    contactCreated = true;
  }

  if (contactId) {
    const { error: createLinkError } = await supabaseService
      .from("linkedin_contact_links")
      .insert({
        workspace_id: connector.workspace_id,
        owner_id: connector.owner_id,
        visibility: "private",
        sender_profile_url: profileUrl,
        contact_id: contactId,
      });
    if (createLinkError && createLinkError.code !== "23505") {
      throw createLinkError;
    }
  }

  return {
    contactId,
    companyId,
    reviewReason: companyId
      ? null
      : prospect?.companyAmbiguous
        ? "outreach_company_ambiguous"
        : existingContact?.company_id
          ? "company_outside_owner_scope"
          : "company_not_verified",
    contactCreated,
  };
}

async function parseAndFilterBatch(
  scope: LinkedInInboxImportScope,
  input: unknown
): Promise<{
  batch: LinkedInInboxBatch;
  messages: LinkedInInboxMessageInput[];
  duplicates: number;
}> {
  const batch = parseLinkedInInboxBatch(input, {
    maxConversations: scope.maxConversations,
    lookbackDays: scope.lookbackDays,
  });
  if (!batch.messages.length) return { batch, messages: [], duplicates: 0 };
  const ids = batch.messages.map((message) => message.messageId);
  const { data, error } = await supabaseService
    .from("linkedin_inbox_messages")
    .select("provider_message_id,sender_profile_url,body,received_at,metadata")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.ownerId)
    .in("provider_message_id", ids);
  if (error) throw error;
  const existing = new Set(
    (data || []).map((row: any) => String(row.provider_message_id))
  );
  const candidates = batch.messages.filter(
    (message) => !existing.has(message.messageId)
  );
  if (!candidates.length) {
    return { batch, messages: [], duplicates: existing.size };
  }

  const profiles = [...new Set(candidates.map((message) => message.senderProfileUrl))];
  const timestamps = candidates.map((message) => new Date(message.receivedAt).getTime());
  const earliest = new Date(Math.min(...timestamps) - 2 * 60 * 1_000).toISOString();
  const latest = new Date(Math.max(...timestamps) + 2 * 60 * 1_000).toISOString();
  const { data: possibleDuplicates, error: duplicateError } = await supabaseService
    .from("linkedin_inbox_messages")
    .select("provider_message_id,sender_profile_url,body,received_at,metadata")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.ownerId)
    .in("sender_profile_url", profiles)
    .gte("received_at", earliest)
    .lte("received_at", latest)
    .limit(1_000);
  if (duplicateError) throw duplicateError;
  let crossSourceDuplicates = 0;
  const messages = candidates.filter((message) => {
    const duplicate = (possibleDuplicates || []).some((row: any) => {
      const existingSource = String(row?.metadata?.source || "");
      if (!existingSource || existingSource === scope.source) return false;
      return (
        row.sender_profile_url === message.senderProfileUrl &&
        String(row.body || "").trim() === message.body.trim() &&
        Math.abs(
          new Date(row.received_at).getTime() - new Date(message.receivedAt).getTime()
        ) <= 2 * 60 * 1_000
      );
    });
    if (duplicate) crossSourceDuplicates += 1;
    return !duplicate;
  });
  return {
    batch,
    messages,
    duplicates: existing.size + crossSourceDuplicates,
  };
}

export async function importLinkedInInboxBatchForScope(
  scope: LinkedInInboxImportScope,
  input: unknown
): Promise<LinkedInInboxImportResult> {
  const { batch, messages, duplicates } = await parseAndFilterBatch(scope, input);
  if (messages.length) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const { count, error: countError } = await supabaseService
      .from("linkedin_inbox_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.ownerId)
      .gte("created_at", cutoff);
    if (countError) throw countError;
    if ((count || 0) + messages.length > LINKEDIN_INBOX_MAX_MESSAGES_PER_24_HOURS) {
      throw Object.assign(
        new Error(
          `The 24-hour safety limit of ${LINKEDIN_INBOX_MAX_MESSAGES_PER_24_HOURS} new messages would be exceeded`
        ),
        { status: 429 }
      );
    }
  }

  const identityScope: LinkedInInboxIdentityScope = {
    workspace_id: scope.workspaceId,
    owner_id: scope.ownerId,
    contactSource: scope.contactSource,
  };
  const identityByProfile = new Map<string, ImportIdentity>();
  for (const message of messages) {
    if (identityByProfile.has(message.senderProfileUrl)) continue;
    identityByProfile.set(
      message.senderProfileUrl,
      await resolveLinkedInIdentity(
        identityScope,
        message.senderProfileUrl,
        message.senderName,
        scope.createContactWhenUnmatched
      )
    );
  }

  const contextRows = messages.flatMap((message) => {
    const identity = identityByProfile.get(message.senderProfileUrl);
    if (!identity?.companyId) return [];
    return [{
      workspace_id: scope.workspaceId,
      owner_id: scope.ownerId,
      visibility: "private",
      company_id: identity.companyId,
      kind: "linkedin_message",
      title: `LinkedIn message from ${message.senderName}`,
      content: message.body,
      created_at: message.receivedAt,
      source_ref: `linkedin:${message.messageId}`,
      metadata: {
        provider: scope.provider,
        source: scope.source,
        conversationId: message.conversationId,
        messageId: message.messageId,
        senderName: message.senderName,
        senderProfileUrl: message.senderProfileUrl,
        receivedAt: message.receivedAt,
        direction: "inbound",
      },
    }];
  });
  if (contextRows.length) {
    const { error } = await supabaseService
      .from("client_context")
      .upsert(contextRows, {
        onConflict: "owner_id,source_ref",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  const sourceRefs = contextRows.map((row) => row.source_ref);
  const contextBySourceRef = new Map<string, string>();
  if (sourceRefs.length) {
    const { data, error } = await supabaseService
      .from("client_context")
      .select("id,source_ref")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.ownerId)
      .in("source_ref", sourceRefs);
    if (error) throw error;
    for (const row of data || []) {
      if (row.source_ref) contextBySourceRef.set(row.source_ref, row.id);
    }
  }

  const rows = messages.map((message) => {
    const identity = identityByProfile.get(message.senderProfileUrl)!;
    return {
      workspace_id: scope.workspaceId,
      owner_id: scope.ownerId,
      visibility: "private",
      connector_id: scope.connectorId || null,
      provider_conversation_id: message.conversationId,
      provider_message_id: message.messageId,
      sender_name: message.senderName,
      sender_profile_url: message.senderProfileUrl,
      body: message.body,
      received_at: message.receivedAt,
      contact_id: identity.contactId,
      company_id: identity.companyId,
      context_id: contextBySourceRef.get(`linkedin:${message.messageId}`) || null,
      status: identity.companyId ? "linked" : "review",
      review_reason: identity.reviewReason,
      metadata: {
        runId: batch.runId,
        capturedAt: batch.capturedAt,
        provider: scope.provider,
        source: scope.source,
        direction: "inbound",
      },
    };
  });
  let importedRows: any[] = [];
  if (rows.length) {
    const { data, error } = await supabaseService
      .from("linkedin_inbox_messages")
      .upsert(rows, {
        onConflict: "owner_id,provider_message_id",
        ignoreDuplicates: true,
      })
      .select("id,status");
    if (error) throw error;
    importedRows = data || [];
  }

  const imported = importedRows.length;
  return {
    runId: batch.runId,
    accepted: batch.messages.length,
    imported,
    duplicates: duplicates + Math.max(0, messages.length - imported),
    linked: importedRows.filter((row) => row.status === "linked").length,
    review: importedRows.filter((row) => row.status === "review").length,
    contactsCreated: [...identityByProfile.values()].filter(
      (identity) => identity.contactCreated
    ).length,
  };
}

export async function importLinkedInInboxBatch(
  connector: LinkedInInboxConnectorRow,
  input: unknown
): Promise<LinkedInInboxImportResult> {
  const startedAt = new Date().toISOString();
  const claimCutoff = new Date(Date.now() - 20_000).toISOString();
  const recentRunMs = new Date(connector.last_run_at || "").getTime();
  if (Number.isFinite(recentRunMs) && Date.now() - recentRunMs < 20_000) {
    throw Object.assign(new Error("Wait 20 seconds before starting another sync"), {
      status: 429,
    });
  }
  const { data: claimed, error: claimError } = await supabaseService
    .from("linkedin_inbox_connectors")
    .update({ last_run_at: startedAt, last_error: null, updated_at: startedAt })
    .eq("id", connector.id)
    .eq("owner_id", connector.owner_id)
    .eq("workspace_id", connector.workspace_id)
    .eq("status", "active")
    .is("revoked_at", null)
    .or(`last_run_at.is.null,last_run_at.lt.${claimCutoff}`)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw Object.assign(new Error("Wait 20 seconds before starting another sync"), {
      status: 429,
    });
  }

  try {
    const result = await importLinkedInInboxBatchForScope(
      {
        workspaceId: connector.workspace_id,
        ownerId: connector.owner_id,
        connectorId: connector.id,
        maxConversations: connector.max_conversations_per_run,
        lookbackDays: connector.lookback_days,
        source: "local_chrome_extension",
        provider: "linkedin_local_connector",
        contactSource: "linkedin_inbox_connector",
        createContactWhenUnmatched: true,
      },
      input
    );
    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabaseService
      .from("linkedin_inbox_connectors")
      .update({
        last_success_at: completedAt,
        last_error: null,
        imported_message_count: connector.imported_message_count + result.imported,
        updated_at: completedAt,
      })
      .eq("id", connector.id)
      .eq("owner_id", connector.owner_id)
      .eq("workspace_id", connector.workspace_id);
    if (updateError) throw updateError;
    return result;
  } catch (error: any) {
    const message = String(error?.message || "LinkedIn inbox import failed").slice(0, 500);
    await supabaseService
      .from("linkedin_inbox_connectors")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", connector.id)
      .eq("owner_id", connector.owner_id)
      .eq("workspace_id", connector.workspace_id);
    throw error;
  }
}
