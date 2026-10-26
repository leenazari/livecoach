import "server-only";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { loadTaskEmailWorkspace, generateTaskEmailDraft } from "@/lib/task-email";
import { isUuid } from "@/lib/uuid";

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

// A notification is an attention receipt. Follow its exact source key to the
// existing task and draft, never infer a recipient from the display name.
export async function loadNotificationEmailWorkspace(notificationId: string) {
  const scope = requireRequestScope();
  if (scope.status !== "active") fail("An active account is required", 403);
  if (!isUuid(notificationId)) fail("Notification not found", 404);
  const { data: notification, error } = await supabaseService.from("crm_notifications")
    .select("id,kind,source_event_key,source_table,source_id")
    .eq("id", notificationId).eq("workspace_id", scope.workspaceId).eq("user_id", scope.userId)
    .is("dismissed_at", null).maybeSingle();
  if (error) throw error;
  if (!notification) fail("Notification not found", 404);
  if (notification.kind !== "important_email" || !/^important_email:(google|microsoft):.+$/.test(notification.source_event_key || "")) {
    fail("Open the original reply to act in its channel. This notification is not a verified mailbox email.", 409);
  }
  const sourceRef = notification.source_event_key.replace(/^important_email:/, "");
  const { data: tasks, error: taskError } = await supabaseService.from("tasks")
    .select("id,company_id,payload")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
    .eq("source", "important_email_monitor").eq("source_ref", sourceRef).limit(2);
  if (taskError) throw taskError;
  if (tasks?.length !== 1) fail("The exact email task is unavailable. Open the source email rather than guessing which conversation to reply to.", 409);
  const task = tasks[0];
  if ((notification.source_table === "companies" && task.company_id !== notification.source_id) ||
      (notification.source_table === "outreach_prospects" && task.payload?.outreachProspectId !== notification.source_id)) {
    fail("The notification and email task no longer refer to the same client", 409);
  }
  const workspace = await loadTaskEmailWorkspace(task.id);
  // Offer only the exact inbound person, not another colleague at their company.
  const recipient = workspace.recipients.find(person => person.source === "inbound");
  if (!recipient) fail("The source email has no verified reply recipient", 409);
  if (workspace.draft && (workspace.draft.recipient_email.toLowerCase() !== recipient.email.toLowerCase() ||
      workspace.draft.mail_provider !== task.payload?.mailProvider ||
      workspace.draft.source_message_id !== task.payload?.mailMessageId ||
      workspace.draft.source_thread_id !== task.payload?.mailThreadId)) {
    fail("The saved draft does not match this exact email conversation. Open the original email before continuing.", 409);
  }
  return {
    ...workspace, recipients: [recipient], selectedRecipientEmail: recipient.email,
    suggestedIntent: String(task.payload?.action || "Answer the sender's questions and agree the appropriate next step."),
    sourceSummary: String(task.payload?.summary || ""),
  };
}

export async function draftNotificationEmail(notificationId: string, input: { intent?: unknown; regenerate?: boolean }) {
  const workspace = await loadNotificationEmailWorkspace(notificationId);
  if (workspace.draft && !input.regenerate && workspace.draft.status === "draft") return workspace.draft;
  return generateTaskEmailDraft({
    taskId: workspace.task.id, recipientEmail: workspace.selectedRecipientEmail,
    intent: input.intent || workspace.suggestedIntent, suggestMeetingTimes: true,
  });
}
