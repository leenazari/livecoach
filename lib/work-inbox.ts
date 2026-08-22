export type WorkInboxKind =
  | "task"
  | "opportunity"
  | "prep"
  | "follow_up"
  | "outreach"
  | "reply"
  | "client_update";

export type WorkInboxItem = {
  id: string;
  sourceId: string;
  kind: WorkInboxKind;
  title: string;
  detail: string | null;
  company: string | null;
  companyId: string | null;
  href: string;
  priority: number;
  priorityLabel: "urgent" | "high" | "normal" | "waiting" | "done";
  dueAt: string | null;
  createdAt: string | null;
  revenue: boolean;
  approval: boolean;
  waiting: boolean;
  done: boolean;
  editable: boolean;
  dismissible: boolean;
};

export type WorkCleanupKind =
  | "duplicate"
  | "stale"
  | "needs_date"
  | "waiting";

export type WorkCleanupSuggestion = {
  id: string;
  kind: WorkCleanupKind;
  title: string;
  reason: string;
  company: string | null;
  companyId: string | null;
  taskIds: string[];
  taskTitles: string[];
  keepTaskId: string | null;
  safeToApply: boolean;
  ageDays: number;
};

export type WorkCleanupSummary = {
  suggestions: WorkCleanupSuggestion[];
  counts: {
    total: number;
    actionable: number;
    flagged: number;
    duplicates: number;
    stale: number;
  };
};

export type WorkInboxResponse = {
  generatedAt: string;
  viewer: {
    userId: string;
    role: "owner" | "manager" | "sales";
  };
  items: WorkInboxItem[];
  cleanup: WorkCleanupSummary;
  counts: {
    now: number;
    urgent: number;
    revenue: number;
    approvals: number;
    waiting: number;
    done: number;
    all: number;
  };
};

export type WorkInboxOpportunity = {
  id: string;
  company_id: string;
  title?: string | null;
  value?: number | string | null;
  pipeline_stage?: string | null;
  win_outlook?: string | null;
  next_action?: string | null;
  next_action_due_at?: string | null;
  next_action_owner?: string | null;
  updated_at?: string | null;
};

const dateMs = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const label = (value: unknown) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function buildOpportunityInboxItem(args: {
  opportunity: WorkInboxOpportunity;
  company: string | null;
  nowMs: number;
  endTodayMs: number;
}): WorkInboxItem {
  const { opportunity, company, nowMs, endTodayMs } = args;
  const action = String(opportunity.next_action || "").trim();
  const dueMs = dateMs(opportunity.next_action_due_at);
  const waiting = opportunity.next_action_owner === "buyer";
  const overdue = !waiting && dueMs != null && dueMs < nowMs;
  const dueToday = !waiting && dueMs != null && dueMs <= endTodayMs;
  const atRisk = opportunity.win_outlook === "at_risk";
  let priority = waiting ? 44 : action ? 82 : 88;
  if (atRisk && !waiting) priority = Math.max(priority, 94);
  if (dueToday) priority = Math.max(priority, 98);
  if (overdue) priority = 110;

  const value = Math.max(0, Number(opportunity.value) || 0);
  const detail = [
    label(opportunity.pipeline_stage || "new"),
    label(opportunity.win_outlook || "not assessed"),
    value
      ? new Intl.NumberFormat("en-GB", {
          style: "currency",
          currency: "GBP",
          maximumFractionDigits: 0,
        }).format(value)
      : "Value not set",
  ].join(" · ");

  return {
    id: `opportunity:${opportunity.id}`,
    sourceId: opportunity.id,
    kind: "opportunity",
    title:
      action ||
      `Set the next action for ${String(opportunity.title || company || "this deal").trim()}`,
    detail,
    company,
    companyId: opportunity.company_id || null,
    href: opportunity.company_id
      ? `/crm/${opportunity.company_id}`
      : "/crm/revenue",
    priority,
    priorityLabel: waiting
      ? "waiting"
      : priority >= 95
        ? "urgent"
        : priority >= 78
          ? "high"
          : "normal",
    dueAt: opportunity.next_action_due_at || null,
    createdAt: opportunity.updated_at || null,
    revenue: true,
    approval: false,
    waiting,
    done: false,
    editable: false,
    dismissible: false,
  };
}
