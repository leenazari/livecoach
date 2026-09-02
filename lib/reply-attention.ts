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

const clean = (value: unknown, maximum: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
// them together when that same owner has queued a reply, scheduled a follow up
// or explicitly marked the reply reviewed.
export async function resolveReplyAttention(input: {
  workspaceId: string;
  userId: string;
  prospectId: string;
}) {
  if (
    !UUID.test(input.workspaceId) ||
    !UUID.test(input.userId) ||
    !UUID.test(input.prospectId)
  ) {
    throw new Error("Reply attention scope is invalid");
  }

  const resolvedAt = new Date().toISOString();
  const [tasksResult, notificationsResult] = await Promise.all([
    supabaseService
      .from("tasks")
      .update({ status: "done", done_at: resolvedAt })
      .eq("workspace_id", input.workspaceId)
      .eq("owner_id", input.userId)
      // Positive email replies created before Reply to Close used the generic
      // email_alert kind. Keep that legacy receipt compatible without ever
      // touching unrelated email tasks.
      .in("kind", ["reply_alert", "email_alert"])
      .eq("status", "open")
      .contains("payload", { outreachProspectId: input.prospectId })
      .select("id"),
    supabaseService
      .from("crm_notifications")
      .update({
        read_at: resolvedAt,
        dismissed_at: resolvedAt,
        snoozed_until: null,
      })
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.userId)
      .eq("kind", "outreach_reply")
      .eq("source_table", "outreach_prospects")
      .eq("source_id", input.prospectId)
      .is("dismissed_at", null)
      .select("id"),
  ]);
  if (tasksResult.error) throw tasksResult.error;
  if (notificationsResult.error) throw notificationsResult.error;

  return {
    resolvedAt,
    completedTasks: tasksResult.data?.length || 0,
    dismissedNotifications: notificationsResult.data?.length || 0,
  };
}
