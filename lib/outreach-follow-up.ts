import "server-only";

import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { supabaseAdmin } from "@/lib/supabase";
import { isNearDuplicateTask, upsertTasks } from "@/lib/tasks";

type Scope = { userId: string; workspaceId: string };

type ProspectForFollowUp = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  crm_company_id?: string | null;
};

const clean = (value: unknown, max: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export function outreachProspectName(prospect: ProspectForFollowUp): string {
  return [prospect.first_name, prospect.last_name]
    .map((part) => clean(part, 120))
    .filter(Boolean)
    .join(" ");
}

export function manualCallReminderText(
  prospect: ProspectForFollowUp,
  nextAction: string
): string {
  const name = outreachProspectName(prospect);
  const company = clean(prospect.company_name, 160);
  const subject = name || company || "this prospect";
  const action = clean(nextAction, 360);
  return `Follow up with ${subject}${action ? `. ${action}` : ""}`.slice(0, 500);
}

async function safeCompanyId(
  prospect: ProspectForFollowUp,
  scope: Scope
): Promise<string | null> {
  const companyId = clean(prospect.crm_company_id, 80);
  if (!companyId) return null;
  const access = await loadAssignedClientAccess(companyId, scope);
  return access?.company?.id || null;
}

// Keep one open manual follow-up per salesperson and prospect. Scheduling the
// same person again reschedules the existing canonical task, while a completed
// reminder stays complete and a later explicit action can create a new row.
export async function saveOutreachFollowUpTask(args: {
  scope: Scope;
  prospect: ProspectForFollowUp;
  requestId: string;
  text: string;
  dueAt: string;
  source: "outreach_manual_follow_up" | "outreach_manual_call";
}) {
  const companyId = await safeCompanyId(args.prospect, args.scope);
  const taskText = clean(args.text, 500);
  const sourceRef = `${args.source}:${args.prospect.id}:${args.requestId}`;
  const payload = {
    pinned: true,
    scheduledTime: true,
    outreachProspectId: args.prospect.id,
    prospectName: outreachProspectName(args.prospect) || null,
    companyName: clean(args.prospect.company_name, 160) || null,
    lastRequestId: args.requestId,
  };

  const { data: prospectTasks, error: prospectTasksError } = await supabaseAdmin
    .from("tasks")
    .select(
      "id,company_id,text,kind,link_kind,status,done_at,created_at,payload,due_at,source,source_ref"
    )
    .eq("workspace_id", args.scope.workspaceId)
    .eq("owner_id", args.scope.userId)
    .eq("status", "open")
    .contains("payload", { outreachProspectId: args.prospect.id })
    .order("created_at", { ascending: false })
    .limit(20);
  if (prospectTasksError) throw prospectTasksError;

  const existingForProspect = (prospectTasks || []).find((task: any) =>
    ["outreach_manual_follow_up", "outreach_manual_call"].includes(task.source)
  );
  if (existingForProspect) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("tasks")
      .update({
        company_id: companyId,
        text: taskText,
        kind: "manual",
        link_kind: "call",
        source: args.source,
        source_ref: sourceRef,
        payload: { ...(existingForProspect.payload || {}), ...payload },
        due_at: args.dueAt,
      })
      .eq("workspace_id", args.scope.workspaceId)
      .eq("owner_id", args.scope.userId)
      .eq("status", "open")
      .eq("id", existingForProspect.id)
      .select(
        "id,company_id,text,kind,link_kind,status,done_at,created_at,payload,due_at,source,source_ref"
      )
      .single();
    if (updateError) throw updateError;
    return { task: updated, created: false, rescheduled: true, linkedCompany: Boolean(companyId) };
  }

  const created = await upsertTasks(companyId, [
    {
      text: taskText,
      kind: "manual",
      linkKind: "call",
      source: args.source,
      sourceRef,
      dueAt: args.dueAt,
      pinned: true,
      payload,
      fingerprintKey: sourceRef,
    },
  ]);
  if (created[0]) {
    return { task: created[0], created: true, rescheduled: false, linkedCompany: Boolean(companyId) };
  }

  // A browser retry may have completed the write before losing its response.
  // A conservative near-duplicate match also reuses the open task rather than
  // producing two reminders for the same person and purpose.
  let fallbackQuery = supabaseAdmin
    .from("tasks")
    .select(
      "id,company_id,text,kind,link_kind,status,done_at,created_at,payload,due_at,source,source_ref"
    )
    .eq("workspace_id", args.scope.workspaceId)
    .eq("owner_id", args.scope.userId)
    .order("created_at", { ascending: false })
    .limit(500);
  fallbackQuery = companyId
    ? fallbackQuery.eq("company_id", companyId)
    : fallbackQuery.is("company_id", null);
  const { data: fallbackTasks, error: fallbackError } = await fallbackQuery;
  if (fallbackError) throw fallbackError;
  const existing = (fallbackTasks || []).find(
    (task: any) =>
      task.source_ref === sourceRef ||
      (task.status === "open" && isNearDuplicateTask(taskText, String(task.text || "")))
  );
  if (!existing) {
    throw new Error("The follow-up reminder was not saved or matched to an existing task");
  }
  if (existing.status !== "open" || existing.source_ref === sourceRef) {
    return { task: existing, created: false, rescheduled: false, linkedCompany: Boolean(companyId) };
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tasks")
    .update({
      link_kind: "call",
      due_at: args.dueAt,
      payload: { ...(existing.payload || {}), ...payload },
    })
    .eq("workspace_id", args.scope.workspaceId)
    .eq("owner_id", args.scope.userId)
    .eq("status", "open")
    .eq("id", existing.id)
    .select(
      "id,company_id,text,kind,link_kind,status,done_at,created_at,payload,due_at,source,source_ref"
    )
    .single();
  if (updateError) throw updateError;
  return { task: updated, created: false, rescheduled: true, linkedCompany: Boolean(companyId) };
}
