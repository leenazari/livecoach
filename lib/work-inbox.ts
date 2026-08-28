export type WorkInboxKind =
  | "task"
  | "opportunity"
  | "prep"
  | "follow_up"
  | "outreach"
  | "reply"
  | "client_update"
  | "opportunity_clarification";

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
  clarification?: {
    existingOpportunityId: string;
    existingTitle: string;
    proposedTitle: string;
    proposedDetail: string | null;
    proposedValue: number | null;
  };
  outreach?: {
    prospectId: string;
    person: string | null;
    email: string | null;
    jobTitle: string | null;
    messageId: string | null;
    messageStatus: string | null;
    draftSubject: string | null;
    draftBody: string | null;
    replyText: string | null;
    replySummary: string | null;
    lastReplyAt: string | null;
    previousSubject: string | null;
    previousBody: string | null;
    previousSentAt: string | null;
  };
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
  pipeline: WorkPipelineSummary;
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
  pipeline_stage_override?: boolean | null;
  next_action_override?: boolean | null;
  engagement_motion?: string | null;
  active_contact_method?: string | null;
  last_meaningful_activity_at?: string | null;
  updated_at?: string | null;
};

export type WorkPipelineDeal = {
  id: string;
  itemId: string;
  companyId: string;
  company: string;
  title: string;
  stage: string;
  outlook: string;
  value: number;
  nextAction: string | null;
  nextActionDueAt: string | null;
  waitingForBuyer: boolean;
  stageProtected: boolean;
  nextActionProtected: boolean;
  engagementMotion: string | null;
  activeContactMethod: string | null;
  lastMeaningfulActivityAt: string | null;
  priority: number;
};

export type WorkPipelineStage = {
  key: string;
  count: number;
  value: number;
};

export type WorkPipelineSummary = {
  totalDeals: number;
  totalValue: number;
  overdue: number;
  atRisk: number;
  missingNextAction: number;
  stages: WorkPipelineStage[];
  deals: WorkPipelineDeal[];
};

const OPEN_PIPELINE_STAGES = [
  "new",
  "discovery",
  "qualified",
  "proposal",
  "negotiation",
  "verbal",
] as const;

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

export function buildWorkPipeline(args: {
  opportunities: WorkInboxOpportunity[];
  companyName: ReadonlyMap<string, string>;
  nowMs: number;
  endTodayMs: number;
}): { summary: WorkPipelineSummary; items: WorkInboxItem[] } {
  const { opportunities, companyName, nowMs, endTodayMs } = args;
  const items: WorkInboxItem[] = [];
  const deals: WorkPipelineDeal[] = [];

  for (const opportunity of opportunities) {
    const company =
      companyName.get(opportunity.company_id) || "Shared sales client";
    const item = buildOpportunityInboxItem({
      opportunity,
      company,
      nowMs,
      endTodayMs,
    });
    items.push(item);
    deals.push({
      id: opportunity.id,
      itemId: item.id,
      companyId: opportunity.company_id,
      company,
      title: String(opportunity.title || company || "Sales opportunity").trim(),
      stage: String(opportunity.pipeline_stage || "new"),
      outlook: String(opportunity.win_outlook || "not_assessed"),
      value: Math.max(0, Number(opportunity.value) || 0),
      nextAction: opportunity.next_action
        ? String(opportunity.next_action).trim()
        : null,
      nextActionDueAt: opportunity.next_action_due_at || null,
      waitingForBuyer: opportunity.next_action_owner === "buyer",
      stageProtected: opportunity.pipeline_stage_override === true,
      nextActionProtected: opportunity.next_action_override === true,
      engagementMotion: opportunity.engagement_motion
        ? String(opportunity.engagement_motion)
        : null,
      activeContactMethod: opportunity.active_contact_method
        ? String(opportunity.active_contact_method)
        : null,
      lastMeaningfulActivityAt:
        opportunity.last_meaningful_activity_at ||
        opportunity.updated_at ||
        null,
      priority: item.priority,
    });
  }

  deals.sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;
    const leftDue = dateMs(left.nextActionDueAt) ?? Number.POSITIVE_INFINITY;
    const rightDue = dateMs(right.nextActionDueAt) ?? Number.POSITIVE_INFINITY;
    return leftDue - rightDue;
  });

  const stages = OPEN_PIPELINE_STAGES.map((key) => {
    const stageDeals = deals.filter((deal) => deal.stage === key);
    return {
      key,
      count: stageDeals.length,
      value: stageDeals.reduce((sum, deal) => sum + deal.value, 0),
    };
  });

  return {
    items,
    summary: {
      totalDeals: deals.length,
      totalValue: deals.reduce((sum, deal) => sum + deal.value, 0),
      overdue: deals.filter((deal) => {
        const dueMs = dateMs(deal.nextActionDueAt);
        return !deal.waitingForBuyer && dueMs != null && dueMs < nowMs;
      }).length,
      atRisk: deals.filter((deal) => deal.outlook === "at_risk").length,
      missingNextAction: deals.filter((deal) => !deal.nextAction).length,
      stages,
      deals,
    },
  };
}
