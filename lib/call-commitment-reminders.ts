import "server-only";
import { supabaseService } from "@/lib/supabase";
import { resolveRecordScope } from "@/lib/record-scope";
import { isQuietHoursActive, mapNotificationPreferences } from "@/lib/crm-notifications";
import { callCommitmentNeedsAttention, commitmentReminderCopy, commitmentReminderDue, commitmentReminderWindow, isCallDeliverable } from "@/lib/call-commitment-policy";
import { prepareCallDeliverableDraft } from "@/lib/call-deliverable-drafts";

const columns = "id,text,status,kind,source,due_at,payload";

export async function runCallCommitmentReminders(now = new Date()) {
  const scope = await resolveRecordScope();
  const [member, preference] = await Promise.all([
    supabaseService.from("workspace_members").select("user_id")
      .eq("workspace_id", scope.workspaceId).eq("user_id", scope.userId).eq("status", "active").maybeSingle(),
    supabaseService.from("crm_notification_preferences").select("*")
      .eq("workspace_id", scope.workspaceId).eq("user_id", scope.userId).maybeSingle(),
  ]);
  if (member.error) throw member.error;
  if (preference.error) throw preference.error;
  if (!member.data) return { reminded: 0 };
  const preferences = mapNotificationPreferences(preference.data);
  const canRemind = preferences.inAppEnabled && preferences.assignmentAlerts &&
    commitmentReminderWindow(now) && !isQuietHoursActive(preferences, now);
  let reminded = 0;
  // Page by immutable ID so old undated tasks cannot hide newer promises.
  let after: string | null = null;
  for (;;) {
    let query = supabaseService.from("tasks").select(columns)
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
      .eq("source", "call").eq("kind", "commitment")
      // New promises are opted into follow-through by call preparation. Older
      // tasks need explicit escalation rather than a retrospective alert flood.
      .eq("payload->>commitmentReminder", "true")
      .eq("payload->>ownerType", "me").in("payload->>preparationKind", ["email", "document"])
      .order("id", { ascending: true }).limit(100);
    if (after) query = query.gt("id", after);
    const batch = await query;
    if (batch.error) throw batch.error;
    const tasks = batch.data || [];
    if (!tasks.length) break;
    const keys = tasks.map(t => `call-commitment:${t.id}`);
    const receipts = await supabaseService.from("crm_notifications")
      .select("id,source_event_key,read_at,dismissed_at,snoozed_until,attention_at,created_at")
      .eq("workspace_id", scope.workspaceId).eq("user_id", scope.userId).in("source_event_key", keys);
    if (receipts.error) throw receipts.error;
    for (const task of tasks) {
      const key = `call-commitment:${task.id}`;
      const receipt = receipts.data?.find(r => r.source_event_key === key);
      if (task.status !== "open") {
        if (receipt && !receipt.dismissed_at) {
          const closed = await supabaseService.from("crm_notifications")
            .update({ read_at: now.toISOString(), dismissed_at: now.toISOString(), snoozed_until: null })
            .eq("workspace_id", scope.workspaceId).eq("user_id", scope.userId).eq("id", receipt.id);
          if (closed.error) throw closed.error;
        }
        continue;
      }
      if (receipt?.dismissed_at || (receipt?.snoozed_until && Date.parse(receipt.snoozed_until) > now.getTime())) continue;
      if (callCommitmentNeedsAttention(task, now)) await prepareCallDeliverableDraft(task.id);
      if (!canRemind || !callCommitmentNeedsAttention(task, now) || !commitmentReminderDue(receipt, now)) continue;
      // Recheck after reading receipts. A completed or deferred promise must not
      // be reminded because a slow worker loaded its previous state.
      const latest = await supabaseService.from("tasks").select(columns)
        .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", task.id).maybeSingle();
      if (latest.error) throw latest.error;
      if (!latest.data || !isCallDeliverable(latest.data) || !callCommitmentNeedsAttention(latest.data, now)) continue;
      const copy = commitmentReminderCopy(latest.data);
      if (!receipt) {
        const saved = await supabaseService.from("crm_notifications").upsert({
          workspace_id: scope.workspaceId, user_id: scope.userId, kind: "work_assigned",
          ...copy, href: "/crm/tasks", source_table: "tasks", source_id: task.id, source_event_key: key,
        }, { onConflict: "user_id,source_event_key", ignoreDuplicates: true }).select("id");
        if (saved.error) throw saved.error;
        reminded += saved.data?.length || 0;
      } else {
        // One durable receipt per promise. Reading only acknowledges an alert;
        // an explicit dismiss stops repeats and snooze postpones the next one.
        const saved = await supabaseService.from("crm_notifications")
          .update({ ...copy, read_at: null, snoozed_until: now.toISOString() })
          .eq("workspace_id", scope.workspaceId).eq("user_id", scope.userId).eq("id", receipt.id)
          .is("dismissed_at", null).eq("attention_at", receipt.attention_at)
          .select("id");
        if (saved.error) throw saved.error;
        reminded += saved.data?.length || 0;
      }
    }
    after = tasks[tasks.length - 1].id;
    if (tasks.length < 100) break;
  }
  return { reminded };
}
