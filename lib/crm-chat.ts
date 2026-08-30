import "server-only";

import { sendConnectedMail } from "@/lib/mail";
import { publicAppOrigin } from "@/lib/public-app-url";
import type { RequestScope } from "@/lib/request-scope";
import { CHAT_FILE_BUCKET } from "@/lib/crm-chat-shared";
import { supabaseService } from "@/lib/supabase";

export {
  CHAT_ALLOWED_MIME_TYPES,
  CHAT_FILE_BUCKET,
  CHAT_MAX_FILE_BYTES,
} from "@/lib/crm-chat-shared";
export const CHAT_MAX_MESSAGE_LENGTH = 5000;

export type ChatAttachmentInput = {
  kind: "file" | "company" | "contact" | "opportunity" | "crm_link";
  targetId?: string | null;
  title: string;
  subtitle?: string | null;
  href?: string | null;
  snapshot?: Record<string, unknown>;
  storagePath?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

export const isOwnedChatUploadPath = (
  scope: Pick<RequestScope, "userId" | "workspaceId">,
  conversationId: string,
  storagePath: string
) => {
  const segments = storagePath.split("/");
  return (
    segments.length === 4 &&
    segments[0] === scope.workspaceId &&
    segments[1] === conversationId &&
    segments[2] === scope.userId &&
    isUuid(segments[3])
  );
};

export async function removeUnattachedChatUpload(
  workspaceId: string,
  storagePath: string
) {
  const { data: attachment, error } = await supabaseService
    .from("crm_chat_attachments")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("storage_path", storagePath)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Chat upload cleanup check failed", error);
    return;
  }
  if (attachment) return;

  const { error: removeError } = await supabaseService.storage
    .from(CHAT_FILE_BUCKET)
    .remove([storagePath]);
  if (removeError) console.error("Chat upload cleanup failed", removeError);
}

export const cleanChatText = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export const safeChatFileName = (value: unknown) => {
  const raw = String(value || "file")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return raw && raw !== "." && raw !== ".." ? raw : "file";
};

export async function requireChatMembership(
  scope: Pick<RequestScope, "userId" | "workspaceId">,
  conversationId: string
) {
  if (!isUuid(conversationId)) throw new Error("Conversation not found");
  const [{ data: membership, error: membershipError }, { data: conversation, error: conversationError }] =
    await Promise.all([
      supabaseService
        .from("crm_chat_conversation_members")
        .select("conversation_id,user_id,unread_count,last_read_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("conversation_id", conversationId)
        .eq("user_id", scope.userId)
        .maybeSingle(),
      supabaseService
        .from("crm_chat_conversations")
        .select("id,workspace_id,kind,name,created_by_user_id,last_message_id,last_message_at,created_at,updated_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("id", conversationId)
        .maybeSingle(),
    ]);
  if (membershipError) throw membershipError;
  if (conversationError) throw conversationError;
  if (!membership || !conversation) throw new Error("Conversation not found");
  return { membership, conversation };
}

async function canUseCompany(
  scope: Pick<RequestScope, "userId" | "workspaceId">,
  company: any
) {
  if (!company || company.workspace_id !== scope.workspaceId) return false;
  if (company.owner_id === scope.userId) return true;
  if (company.visibility === "team") return true;
  const { data: share, error } = await supabaseService
    .from("team_client_shares")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("company_id", company.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return !!share;
}

export async function buildChatRecordAttachment(
  scope: Pick<RequestScope, "userId" | "workspaceId">,
  kind: string,
  targetId: string
): Promise<ChatAttachmentInput> {
  if (!isUuid(targetId)) throw new Error("Choose a valid CRM record");

  if (kind === "company") {
    const { data: company, error } = await supabaseService
      .from("companies")
      .select(
        "id,workspace_id,owner_id,visibility,name,sector,stage,domain,website,is_confidential"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw error;
    if (!company || !(await canUseCompany(scope, company))) {
      throw new Error("Client not found");
    }
    if (company.is_confidential) {
      throw new Error("Confidential clients cannot be shared into chat");
    }
    const subtitle = [company.sector, company.stage].filter(Boolean).join(" · ");
    return {
      kind: "company",
      targetId: company.id,
      title: String(company.name || "Client").slice(0, 220),
      subtitle: subtitle || null,
      href: `/crm/${company.id}`,
      snapshot: {
        name: company.name || null,
        sector: company.sector || null,
        stage: company.stage || null,
        domain: company.domain || null,
        website: company.website || null,
      },
    };
  }

  if (kind === "contact") {
    const { data: contact, error } = await supabaseService
      .from("contacts")
      .select(
        "id,workspace_id,owner_id,visibility,company_id,name,role,email,sector"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw error;
    if (
      !contact ||
      (contact.owner_id !== scope.userId && contact.visibility !== "team")
    ) {
      throw new Error("Contact not found");
    }

    let company: any = null;
    if (contact.company_id) {
      const { data, error: companyError } = await supabaseService
        .from("companies")
        .select("id,workspace_id,owner_id,visibility,name,is_confidential")
        .eq("workspace_id", scope.workspaceId)
        .eq("id", contact.company_id)
        .maybeSingle();
      if (companyError) throw companyError;
      company = data;
      if (company?.is_confidential) {
        throw new Error("Contacts at confidential clients cannot be shared into chat");
      }
    }

    const subtitle = [contact.role, company?.name].filter(Boolean).join(" · ");
    return {
      kind: "contact",
      targetId: contact.id,
      title: String(contact.name || "Contact").slice(0, 220),
      subtitle: subtitle || null,
      href: company?.id ? `/crm/${company.id}` : "/crm/board?tab=clients",
      snapshot: {
        name: contact.name || null,
        role: contact.role || null,
        email: contact.email || null,
        sector: contact.sector || null,
        companyName: company?.name || null,
      },
    };
  }

  throw new Error("That CRM record type is not shareable yet");
}

const htmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export async function sendChatEmailNotifications(input: {
  scope: Pick<RequestScope, "userId" | "workspaceId">;
  conversationId: string;
  messageId: string;
  requestOrigin?: string;
}) {
  const { scope, conversationId, messageId } = input;
  const membersResult = await supabaseService
    .from("crm_chat_conversation_members")
    .select("user_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("conversation_id", conversationId)
    .neq("user_id", scope.userId);
  if (membersResult.error) throw membersResult.error;
  const recipientIds = (membersResult.data || []).map((row: any) => row.user_id);
  const profileIds = [...new Set([scope.userId, ...recipientIds])];
  const [profilesResult, conversationResult, preferencesResult] =
    await Promise.all([
      supabaseService
        .from("profiles")
        .select("user_id,display_name,email")
        .in("user_id", profileIds),
      supabaseService
        .from("crm_chat_conversations")
        .select("kind,name")
        .eq("workspace_id", scope.workspaceId)
        .eq("id", conversationId)
        .single(),
      supabaseService
        .from("crm_notification_preferences")
        .select("user_id,chat_email_enabled")
        .eq("workspace_id", scope.workspaceId)
        .in("user_id", recipientIds),
    ]);
  for (const result of [
    profilesResult,
    conversationResult,
    preferencesResult,
  ]) {
    if (result.error) throw result.error;
  }
  if (!conversationResult.data) throw new Error("Conversation not found");

  const memberIds = new Set(recipientIds);
  const profiles = (profilesResult.data || []).filter((row: any) =>
    memberIds.has(row.user_id)
  );
  const senderProfile = (profilesResult.data || []).find(
    (row: any) => row.user_id === scope.userId
  );
  const senderName = String(senderProfile?.display_name || "A teammate").trim();
  const preferences = new Map(
    (preferencesResult.data || []).map((row: any) => [
      row.user_id,
      row.chat_email_enabled !== false,
    ])
  );
  const appOrigin = publicAppOrigin(input.requestOrigin);
  const chatUrl = `${appOrigin}/crm/chat?conversation=${conversationId}`;
  const conversationName =
    conversationResult.data.kind === "group"
      ? String(conversationResult.data.name || "your group")
      : "your direct chat";

  await Promise.allSettled(
    profiles.map(async (profile: any) => {
      const email = String(profile.email || "").trim().toLowerCase();
      const enabled = preferences.get(profile.user_id) !== false;
      const initialStatus = !enabled || !email ? "skipped" : "pending";
      const initialError = !enabled
        ? "Chat email alerts are disabled"
        : !email
          ? "Workspace profile has no email address"
          : null;
      const { data: delivery, error: deliveryError } = await supabaseService
        .from("crm_chat_email_deliveries")
        .insert({
          workspace_id: scope.workspaceId,
          message_id: messageId,
          user_id: profile.user_id,
          status: initialStatus,
          error: initialError,
          attempted_at: initialStatus === "skipped" ? new Date().toISOString() : null,
        })
        .select("id,status")
        .maybeSingle();
      if (deliveryError?.code === "23505") return;
      if (deliveryError) throw deliveryError;
      if (!delivery || initialStatus === "skipped") return;

      const safeName = htmlEscape(String(profile.display_name || "there"));
      const safeSender = htmlEscape(senderName);
      const safeConversation = htmlEscape(conversationName);
      const safeUrl = htmlEscape(chatUrl);
      const sent = await sendConnectedMail(
        {
          to: email,
          subject: `New LiveCoach message from ${senderName}`,
          text: `${senderName} sent you a message in ${conversationName}. Open LiveCoach to read it securely. ${chatUrl}`,
          html: `<div style="font-family:Arial,sans-serif;color:#171717;line-height:1.6"><p>Hi ${safeName},</p><p><strong>${safeSender}</strong> sent you a message in ${safeConversation}.</p><p>The message and any shared CRM details stay inside LiveCoach.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#b7791f;color:#fff;text-decoration:none;font-weight:700">Open secure chat</a></p></div>`,
        },
        scope.userId
      );
      await supabaseService
        .from("crm_chat_email_deliveries")
        .update({
          status: sent.ok ? "sent" : "failed",
          provider_message_id: sent.id || null,
          error: sent.ok ? null : String(sent.error || "Email could not be sent").slice(0, 1000),
          attempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id)
        .eq("workspace_id", scope.workspaceId);
    })
  );
}
