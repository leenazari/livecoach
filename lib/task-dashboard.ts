export type TaskDashboardView =
  | "open"
  | "flagged"
  | "overdue"
  | "today"
  | "upcoming"
  | "no_date"
  | "completed";

export type TaskDashboardItem = {
  id: string;
  status: string;
  created_at: string;
  done_at?: string | null;
  due_at?: string | null;
  scheduled_at?: string | null;
  upcoming_id?: string | null;
  payload?: {
    pinned?: boolean;
    scheduledTime?: boolean;
    [key: string]: unknown;
  } | null;
};

export type TaskDashboardCounts = {
  open: number;
  flagged: number;
  overdue: number;
  today: number;
  upcoming: number;
  no_date: number;
  completed: number;
  completedToday: number;
};

const localDayBounds = (now: Date) => {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  ).getTime();
  return { start, end };
};

export const taskDueValue = (task: TaskDashboardItem): string | null =>
  task.due_at || task.scheduled_at || null;

export const taskDueTime = (task: TaskDashboardItem): number | null => {
  const value = taskDueValue(task);
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const completedToday = (task: TaskDashboardItem, now: Date) => {
  if (task.status !== "done" || !task.done_at) return false;
  const doneAt = new Date(task.done_at).getTime();
  if (!Number.isFinite(doneAt)) return false;
  const bounds = localDayBounds(now);
  return doneAt >= bounds.start && doneAt < bounds.end;
};

export const taskTimeBucket = (
  task: TaskDashboardItem,
  now = new Date()
): "overdue" | "today" | "upcoming" | "no_date" | "completed" => {
  if (task.status === "done") return "completed";
  const due = taskDueTime(task);
  if (due == null) return "no_date";
  const bounds = localDayBounds(now);
  const hasExactTime =
    Boolean(task.upcoming_id) || task.payload?.scheduledTime === true;
  if (hasExactTime ? due < now.getTime() : due < bounds.start) {
    return "overdue";
  }
  if (due < bounds.end) return "today";
  return "upcoming";
};

export const countTaskDashboard = (
  tasks: TaskDashboardItem[],
  now = new Date()
): TaskDashboardCounts => {
  const counts: TaskDashboardCounts = {
    open: 0,
    flagged: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
    no_date: 0,
    completed: 0,
    completedToday: 0,
  };
  for (const task of tasks) {
    if (task.status === "done") {
      counts.completed += 1;
      if (completedToday(task, now)) counts.completedToday += 1;
      continue;
    }
    if (task.status !== "open") continue;
    counts.open += 1;
    if (task.payload?.pinned === true) counts.flagged += 1;
    const bucket = taskTimeBucket(task, now);
    if (bucket !== "completed") counts[bucket] += 1;
  }
  return counts;
};

export const taskMatchesDashboardView = (
  task: TaskDashboardItem,
  view: TaskDashboardView,
  now = new Date()
) => {
  if (view === "completed") return task.status === "done";
  if (task.status !== "open") return false;
  if (view === "open") return true;
  if (view === "flagged") return task.payload?.pinned === true;
  return taskTimeBucket(task, now) === view;
};

export const sortTaskDashboard = <T extends TaskDashboardItem>(tasks: T[]) =>
  [...tasks].sort((a, b) => {
    if (a.status === "done" || b.status === "done") {
      if (a.status !== b.status) return a.status === "done" ? 1 : -1;
      return (
        new Date(b.done_at || b.created_at).getTime() -
        new Date(a.done_at || a.created_at).getTime()
      );
    }
    const pinDifference =
      Number(b.payload?.pinned === true) -
      Number(a.payload?.pinned === true);
    if (pinDifference) return pinDifference;
    const aDue = taskDueTime(a) ?? Number.POSITIVE_INFINITY;
    const bDue = taskDueTime(b) ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
