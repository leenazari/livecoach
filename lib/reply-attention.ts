import "server-only";

import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseService } from "@/lib/supabase";
import { upsertTasks } from "@/lib/tasks";

export type ReplyAttentionCategory =
  | "interested"
  | "objection"
  | "later"
  | "referral"
  | "unsubscribe"
  | "irrelevant"
  | "unclassified";

type ReplyAttentionInput = {
  workspaceId: string;
  userId: string;
  companyId: string | null;
  prospectId: string;
  prospectName: string;
  companyName: string;
  channel: "linkedin" | "email";
  category: ReplyAttentionCategory;
  summary: string;
  sourceRef: string;
  receivedAt: string;
};

type ReplyAttentionScope = {
  workspaceId: string;
  userId: string;
  prospectId: string;
};

const clean = (value: unknown, maximum: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REPLY_ATTENTION_CATEGORIES = new Set<ReplyAttentionCategory>([
  "interested",
  "objection",
  "later",
  "referral",
  "unsubscribe",
  "irrelevant",
  "unclassified",
]);

const replyAttentionCategory = (value: unknown): ReplyAttentionCategory => {
  const category = String(value || "") as ReplyAttentionCategory;
  return REPLY_ATTENTION_CATEGORIES.has(category) ? category : "unclassified";
};

export function replyAttentionTaskText(input: {
  prospectName: string;
  channel: "linkedin" | "email";
  category: ReplyAttentionCategory;
}) {
  const person = clean(input.prospectName, 160) || "the prospect";
  const channel = input.channel === "linkedin" ? "LinkedIn" : "email";
  if (input.category === "interested")
    return `Respond to ${person}'s positive ${channel} reply and agree the next step`;
  if (input.category === "referral")
    return `Follow up ${person}'s ${channel} referral and request the introduction`;
  if (input.category === "objection")
    return `Review ${person}'s ${channel} objection and prepare a relevant response`;
  if (input.category === "later")
    return `Review ${person}'s ${channel} reply and agree when to follow up`;
  if (input.category === "unsubscribe")
    return `Review ${person}'s stop request and confirm outreach is closed`;
  if (input.category === "irrelevant")
    return `Review ${person}'s ${channel} reply and close the outreach outcome`;
  return `Review ${person}'s new ${channel} reply and decide the next action`;
}

// SendPilot webhooks and recovery backfills do not have a browser request
// context. Bind the exact integration owner before using the canonical task
// writer so two salespeople can never receive each other's reply task.
export async function ensureReplyAttentionTask(input: ReplyAttentionInput) {
  if (
    !UUID.test(input.workspaceId) ||
    !UUID.test(input.userId) ||
    !UUID.test(input.prospectId) ||
    (input.companyId !== null && !UUID.test(input.companyId)) ||
    !clean(input.sourceRef, 500)
  ) {
    throw new Error("Reply attention task scope is invalid");
  }

  const { data: membership, error: membershipError } = await supabaseService
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return [];

  const taskText = replyAttentionTaskText(input);
  const sourceRef = clean(input.sourceRef, 500);
  const received = new Date(input.receivedAt);
  const receivedAt = Number.isFinite(received.getTime())
    ? received.toISOString()
    : new Date().toISOString();
  return runWithServiceRecordScope(
    { userId: input.userId, workspaceId: input.workspaceId },
    () =>
      upsertTasks(input.companyId, [
        {
          text: taskText,
          kind: "reply_alert",
          linkKind: "client",
          source:
            input.channel === "linkedin"
              ? "sendpilot_reply"
              : "outreach_reply",
          sourceRef,
          fingerprintKey: sourceRef,
          distinctSourceEvent: true,
          payload: {
            outreachProspectId: input.prospectId,
            prospectName: clean(input.prospectName, 160) || null,
            companyName: clean(input.companyName, 160) || null,
            channel: input.channel,
            replyCategory: input.category,
            summary: clean(input.summary, 300),
            receivedAt,
          },
          dueAt: receivedAt,
          pinned: input.category === "interested" || input.category === "referral",
        },
      ])
  );
}

// A reply remains authoritative on outreach_prospects and outreach_events.
// These rows are only the owner-specific attention receipts around it. Close
// them together only when that same owner's reply is provider-confirmed,
// a dated follow up is saved, or the owner explicitly marks it reviewed.
export async function resolveReplyAttention(input: {
  workspaceId: string;
  userId: string;
  prospectId: string;
  receivedAt?: string | null;
  messageId?: string | null;
}) {
  if (
    !UUID.test(input.workspaceId) ||
    !UUID.test(input.userId) ||
    !UUID.test(input.prospectId) ||
    (input.messageId != null && !UUID.test(input.messageId))
  ) {
    throw new Error("Reply attention scope is invalid");
  }

  const resolvedAt = new Date().toISOString();
  const receivedAtMs = input.receivedAt
    ? new Date(input.receivedAt).getTime()
    : null;
  const receivedAt = Number.isFinite(receivedAtMs)
    ? new Date(receivedAtMs as number).toISOString()
    : null;
  const [taskReceipts, notificationReceipts] = await Promise.all([
    supabaseService
      .from("tasks")
      .select("id,payload")
      .eq("workspace_id", input.workspaceId)
      .eq("owner_id", input.userId)
      // Positive email replies created before Reply to Close used the generic
      // email_alert kind. Keep that legacy receipt compatible without ever
      // touching unrelated email tasks.
      .in("kind", ["reply_alert", "email_alert"])
      .eq("status", "open")
      .contains("payload", { outreachProspectId: input.prospectId }),
    supabaseService
      .from("crm_notifications")
      .select("id,source_event_key")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .eq("kind", "outreach_reply")
      .eq("source_table", "outreach_prospects")
      .eq("source_id", input.prospectId)
      .is("dismissed_at", null),
  ]);
  if (taskReceipts.error) throw taskReceipts.error;
  if (notificationReceipts.error) throw notificationReceipts.error;

  const taskIds = (taskReceipts.data || [])
    .filter((task) => {
      if (!receivedAt) return true;
      const taskReceivedAt = new Date(task.payload?.receivedAt || 0).getTime();
      return (
        Number.isFinite(taskReceivedAt) &&
        Math.abs(taskReceivedAt - (receivedAtMs as number)) < 1_000
      );
    })
    .map((task) => task.id);
  const notificationIds = (notificationReceipts.data || [])
    .filter((notification) => {
      const key = String(notification.source_event_key || "");
      if (
        input.messageId &&
        key === `outreach_reply_delivery_failed:${input.messageId}`
      ) {
        return true;
      }
      if (!receivedAt) return true;
      const prefix = `outreach_reply:${input.prospectId}:`;
      if (!key.startsWith(prefix)) return false;
      const notificationReceivedAt = new Date(key.slice(prefix.length)).getTime();
      return (
        Number.isFinite(notificationReceivedAt) &&
        Math.abs(notificationReceivedAt - (receivedAtMs as number)) < 1_000
      );
    })
    .map((notification) => notification.id);
  const [tasksResult, notificationsResult] = await Promise.all([
    taskIds.length
      ? supabaseService
          .from("tasks")
          .update({ status: "done", done_at: resolvedAt })
          .eq("workspace_id", input.workspaceId)
          .eq("owner_id", input.userId)
          .in("id", taskIds)
          .select("id")
      : Promise.resolve({ data: [] as any[], error: null }),
    notificationIds.length
      ? supabaseService
          .from("crm_notifications")
          .update({
            read_at: resolvedAt,
            dismissed_at: resolvedAt,
            snoozed_until: null,
          })
          .eq("workspace_id", input.workspaceId)
          .eq("user_id", input.userId)
          .in("id", notificationIds)
          .select("id")
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (tasksResult.error) throw tasksResult.error;
  if (notificationsResult.error) throw notificationsResult.error;

  return {
    resolvedAt,
    completedTasks: tasksResult.data?.length || 0,
    dismissedNotifications: notificationsResult.data?.length || 0,
  };
}

// Queueing is not delivery. If a provider refuses a reply, restore the exact
// owner's existing attention receipts so the buyer cannot silently disappear
// from Today. The outreach prospect and immutable event history remain the
// canonical evidence and are never rewritten here.
export async function reopenReplyAttention(
  input: ReplyAttentionScope & {
    messageId?: string | null;
    receivedAt?: string | null;
    failureReason?: string | null;
  }
) {
  if (
    !UUID.test(input.workspaceId) ||
    !UUID.test(input.userId) ||
    !UUID.test(input.prospectId) ||
    (input.messageId != null && !UUID.test(input.messageId))
  ) {
    throw new Error("Reply attention scope is invalid");
  }

  const { data: membership, error: membershipError } = await supabaseService
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) {
    return { reopenedAt: null, reopenedTasks: 0, reopenedNotifications: 0 };
  }

  const reopenedAt = new Date().toISOString();
  const reason = clean(input.failureReason, 500);
  const receivedAtMs = input.receivedAt
    ? new Date(input.receivedAt).getTime()
    : null;
  const [taskReceiptResult, notificationReceiptResult] = await Promise.all([
    supabaseService
      .from("tasks")
      .select("id,payload")
      .eq("workspace_id", input.workspaceId)
      .eq("owner_id", input.userId)
      .in("kind", ["reply_alert", "email_alert"])
      .contains("payload", { outreachProspectId: input.prospectId })
      .order("created_at", { ascending: false }),
    supabaseService
      .from("crm_notifications")
      .select("id,source_event_key")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .eq("kind", "outreach_reply")
      .eq("source_table", "outreach_prospects")
      .eq("source_id", input.prospectId)
      .order("created_at", { ascending: false }),
  ]);
  if (taskReceiptResult.error) throw taskReceiptResult.error;
  if (notificationReceiptResult.error) throw notificationReceiptResult.error;

  const taskReceiptId =
    (taskReceiptResult.data || []).find((task) => {
      if (!Number.isFinite(receivedAtMs)) return true;
      const taskReceivedAt = new Date(task.payload?.receivedAt || 0).getTime();
      return (
        Number.isFinite(taskReceivedAt) &&
        Math.abs(taskReceivedAt - (receivedAtMs as number)) < 1_000
      );
    })?.id || null;
  const notificationReceiptId =
    (notificationReceiptResult.data || []).find((notification) => {
      const key = String(notification.source_event_key || "");
      if (
        input.messageId &&
        key === `outreach_reply_delivery_failed:${input.messageId}`
      ) {
        return true;
      }
      if (!Number.isFinite(receivedAtMs)) return true;
      const prefix = `outreach_reply:${input.prospectId}:`;
      if (!key.startsWith(prefix)) return false;
      const notificationReceivedAt = new Date(key.slice(prefix.length)).getTime();
      return (
        Number.isFinite(notificationReceivedAt) &&
        Math.abs(notificationReceivedAt - (receivedAtMs as number)) < 1_000
      );
    })?.id || null;
  const [taskUpdateResult, notificationUpdateResult] = await Promise.all([
    taskReceiptId
      ? supabaseService
          .from("tasks")
          .update({
            status: "open",
            done_at: null,
            due_at: reopenedAt,
            pinned: true,
          })
          .eq("workspace_id", input.workspaceId)
          .eq("owner_id", input.userId)
          .eq("id", taskReceiptId)
          .select("id")
      : Promise.resolve({ data: [] as any[], error: null }),
    notificationReceiptId
      ? supabaseService
          .from("crm_notifications")
          .update({
            read_at: null,
            dismissed_at: null,
            snoozed_until: null,
            title: "Reply delivery needs attention",
            body:
              reason ||
              "The reply was not accepted by the connected mailbox. Review it and try again.",
            href: `/crm/outreach?tab=replies&reply=${encodeURIComponent(input.prospectId)}`,
          })
          .eq("workspace_id", input.workspaceId)
          .eq("user_id", input.userId)
          .eq("id", notificationReceiptId)
          .select("id")
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (taskUpdateResult.error) throw taskUpdateResult.error;
  if (notificationUpdateResult.error) throw notificationUpdateResult.error;

  let reopenedTasks = taskUpdateResult.data?.length || 0;
  let reopenedNotifications = notificationUpdateResult.data?.length || 0;
  if (!reopenedTasks || !reopenedNotifications) {
    const { data: prospect, error: prospectError } = await supabaseService
      .from("outreach_prospects")
      .select(
        "id,crm_company_id,first_name,last_name,company_name,reply_thread_id,reply_category,reply_summary,last_reply_at"
      )
      .eq("workspace_id", input.workspaceId)
      .eq("assigned_to_user_id", input.userId)
      .eq("id", input.prospectId)
      .maybeSingle();
    if (prospectError) throw prospectError;
    if (!prospect) throw new Error("Reply attention prospect ownership is invalid");

    const receivedAt = Number.isFinite(receivedAtMs)
      ? new Date(receivedAtMs as number).toISOString()
      : prospect.last_reply_at || reopenedAt;
    if (!reopenedTasks) {
      const created = await ensureReplyAttentionTask({
        workspaceId: input.workspaceId,
        userId: input.userId,
        companyId: UUID.test(String(prospect.crm_company_id || ""))
          ? String(prospect.crm_company_id)
          : null,
        prospectId: input.prospectId,
        prospectName: [prospect.first_name, prospect.last_name]
          .map((value) => clean(value, 100))
          .filter(Boolean)
          .join(" "),
        companyName: clean(prospect.company_name, 160),
        channel: String(prospect.reply_thread_id || "").startsWith("sendpilot:")
          ? "linkedin"
          : "email",
        category: replyAttentionCategory(prospect.reply_category),
        summary: reason || clean(prospect.reply_summary, 300),
        sourceRef: input.messageId
          ? `reply-delivery-failed:${input.messageId}`
          : `reply-delivery-failed:${input.prospectId}:${receivedAt}`,
        receivedAt,
      });
      reopenedTasks = created.length;
    }
    if (!reopenedNotifications) {
      const { data: createdNotification, error: createNotificationError } =
        await supabaseService
          .from("crm_notifications")
          .upsert(
            {
              workspace_id: input.workspaceId,
              user_id: input.userId,
              kind: "outreach_reply",
              title: "Reply delivery needs attention",
              body:
                reason ||
                "The reply was not accepted by the connected mailbox. Review it and try again.",
              href: `/crm/outreach?tab=replies&reply=${encodeURIComponent(input.prospectId)}`,
              source_table: "outreach_prospects",
              source_id: input.prospectId,
              source_event_key: input.messageId
                ? `outreach_reply_delivery_failed:${input.messageId}`
                : `outreach_reply_delivery_failed:${input.prospectId}:${receivedAt}`,
            },
            { onConflict: "user_id,source_event_key", ignoreDuplicates: true }
          )
          .select("id");
      if (createNotificationError) throw createNotificationError;
      reopenedNotifications = createdNotification?.length || 0;
    }
  }

  return {
    reopenedAt,
    reopenedTasks,
    reopenedNotifications,
  };
}
