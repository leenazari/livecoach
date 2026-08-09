export type WorkInboxKind =
  | "task"
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
