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

export function selectNextDayTasks<T extends DailyDigestTaskCandidate>(
  tasks: T[],
  options: {
    now: Date;
    timeZone: string;
  }
): SelectedDailyDigestTask<T>[] {
  const { now, timeZone } = options;
  const targetDay = dayKey(new Date(now.getTime() + DAY_MS), timeZone);

  return tasks
    .map((task) => {
      const text = String(task.text || "").trim();
      if (!text || task.kind === "counterparty_commitment") return null;

      const dueMs = validTime(task.due_at);
      const dueDay = dueMs == null ? null : dayKey(new Date(dueMs), timeZone);
      if (dueMs == null || dueDay !== targetDay) return null;

      const digestReason = task.payload?.scheduledTime === true
        ? `Due tomorrow at ${new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(dueMs))}`
        : "Due tomorrow";
      return {
        task,
        dueMs,
        createdMs: validTime(task.created_at) ?? 0,
        digestReason,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => {
      if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
      return b.createdMs - a.createdMs;
    })
    .map(({ task, digestReason }) => ({ ...task, digestReason }));
}
