export type DailyDigestTaskCandidate = {
  id: string;
  text: string;
  company_id?: string | null;
  kind?: string | null;
  due_at?: string | null;
  created_at?: string | null;
  payload?: {
    pinned?: boolean;
    scheduledTime?: boolean;
    urgency?: string;
    [key: string]: unknown;
  } | null;
};

export type SelectedDailyDigestTask<T extends DailyDigestTaskCandidate> = T & {
  digestReason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const validTime = (value: unknown): number | null => {
  if (!value) return null;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const urgencyScore = (value: unknown) => {
  const urgency = String(value || "").trim().toLowerCase();
  if (urgency === "urgent") return 40;
  if (urgency === "high") return 25;
  if (urgency === "medium") return 10;
  return 0;
};

export function selectNextDayTasks<T extends DailyDigestTaskCandidate>(
  tasks: T[],
  options: {
    now: Date;
    timeZone: string;
    limit?: number;
    opportunityValueByCompany?: Map<string, number>;
  }
): SelectedDailyDigestTask<T>[] {
  const { now, timeZone } = options;
  const limit = Math.max(0, Math.min(20, Math.floor(options.limit ?? 5)));
  if (!limit) return [];

  const today = dayKey(now, timeZone);
  const targetDay = dayKey(new Date(now.getTime() + DAY_MS), timeZone);
  const values = options.opportunityValueByCompany || new Map<string, number>();

  return tasks
    .map((task) => {
      const text = String(task.text || "").trim();
      if (!text || task.kind === "counterparty_commitment") return null;

      const dueMs = validTime(task.due_at);
      const dueDay = dueMs == null ? null : dayKey(new Date(dueMs), timeZone);
      if (dueDay && dueDay > targetDay) return null;

      const pinned = task.payload?.pinned === true;
      let group = 3;
      let digestReason = "Suggested next task";
      if (dueDay === targetDay) {
        group = 0;
        digestReason = task.payload?.scheduledTime === true
          ? `Due tomorrow at ${new Intl.DateTimeFormat("en-GB", {
              timeZone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(new Date(dueMs!))}`
          : "Due tomorrow";
      } else if (dueDay) {
        group = 1;
        digestReason = dueDay === today
          ? "Carry over from today"
          : "Overdue, carry into tomorrow";
      } else if (pinned) {
        group = 2;
        digestReason = "Pinned priority for tomorrow";
      } else if (task.kind === "commitment") {
        digestReason = "Commitment to complete tomorrow";
      }

      const companyValue = task.company_id
        ? Number(values.get(task.company_id)) || 0
        : 0;
      const priority =
        (pinned ? 60 : 0) +
        urgencyScore(task.payload?.urgency) +
        (task.kind === "commitment" ? 20 : 0) +
        Math.min(20, companyValue / 50_000);
      return {
        task,
        group,
        priority,
        dueMs: dueMs ?? Number.POSITIVE_INFINITY,
        createdMs: validTime(task.created_at) ?? 0,
        digestReason,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
      return b.createdMs - a.createdMs;
    })
    .slice(0, limit)
    .map(({ task, digestReason }) => ({ ...task, digestReason }));
}
