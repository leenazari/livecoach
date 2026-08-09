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

export type WorkInboxResponse = {
  generatedAt: string;
  items: WorkInboxItem[];
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
