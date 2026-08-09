import { isNearDuplicateTask } from "@/lib/tasks";
import type {
  WorkCleanupSuggestion,
  WorkCleanupSummary,
} from "@/lib/work-inbox";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CleanupTask = {
  id: string;
  company_id: string | null;
  text: string;
  kind: string | null;
  link_kind: string | null;
  status: string;
  created_at: string | null;
  due_at: string | null;
  payload: Record<string, unknown> | null;
};

const ageInDays = (createdAt: string | null, nowMs: number) => {
  const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
  return Number.isFinite(createdMs)
    ? Math.max(0, Math.floor((nowMs - createdMs) / DAY_MS))
    : 0;
};

const taskRank = (task: CleanupTask) => {
  const pinned = task.payload?.pinned === true ? 1 : 0;
  const dueMs = task.due_at ? new Date(task.due_at).getTime() : NaN;
  const createdMs = task.created_at ? new Date(task.created_at).getTime() : 0;
  return {
    pinned,
    hasDue: Number.isFinite(dueMs) ? 1 : 0,
    dueMs: Number.isFinite(dueMs) ? dueMs : Number.POSITIVE_INFINITY,
    createdMs: Number.isFinite(createdMs) ? createdMs : 0,
  };
};

const chooseKeeper = (tasks: CleanupTask[]) =>
  [...tasks].sort((a, b) => {
    const ar = taskRank(a);
    const br = taskRank(b);
    if (ar.pinned !== br.pinned) return br.pinned - ar.pinned;
    if (ar.hasDue !== br.hasDue) return br.hasDue - ar.hasDue;
    if (ar.dueMs !== br.dueMs) return ar.dueMs - br.dueMs;
    return br.createdMs - ar.createdMs;
  })[0];

const summary = (
  suggestions: WorkCleanupSuggestion[]
): WorkCleanupSummary => ({
  suggestions,
  counts: {
    total: suggestions.length,
    actionable: suggestions.filter((item) => item.safeToApply).length,
    flagged: suggestions.filter((item) => !item.safeToApply).length,
    duplicates: suggestions.filter((item) => item.kind === "duplicate").length,
    stale: suggestions.filter((item) => item.kind === "stale").length,
  },
});

// Conservative, deterministic hygiene for the Work Inbox. It never calls a
// model and never mutates data. Only exact/near-duplicate groups and old loose
// tasks become batch-applicable suggestions. Revenue-linked work, waiting
// commitments and missing deadlines are flagged for a human/Brain edit instead.
export function buildWorkCleanup(
  rows: CleanupTask[],
  companyNames: Map<string, string>,
  revenueCompanies: Set<string>,
  nowMs = Date.now()
): WorkCleanupSummary {
  const tasks = (rows || []).filter(
    (task) => task?.status === "open" && task.id && task.text?.trim()
  );
  const suggestions: WorkCleanupSuggestion[] = [];
  const grouped = new Map<string, CleanupTask[]>();
  for (const task of tasks) {
    const key = task.company_id || "global";
    const bucket = grouped.get(key) || [];
    bucket.push(task);
    grouped.set(key, bucket);
  }

  const duplicateIds = new Set<string>();
  for (const bucket of grouped.values()) {
    const parent = bucket.map((_, index) => index);
    const find = (index: number): number => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    const union = (a: number, b: number) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootB] = rootA;
    };
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (isNearDuplicateTask(bucket[i].text, bucket[j].text)) union(i, j);
      }
    }
    const clusters = new Map<number, CleanupTask[]>();
    bucket.forEach((task, index) => {
      const root = find(index);
      const cluster = clusters.get(root) || [];
      cluster.push(task);
      clusters.set(root, cluster);
    });
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;
      const keeper = chooseKeeper(cluster);
      const dismiss = cluster.filter((task) => task.id !== keeper.id);
      dismiss.forEach((task) => duplicateIds.add(task.id));
      const oldestAge = Math.max(
        ...cluster.map((task) => ageInDays(task.created_at, nowMs))
      );
      suggestions.push({
        id: `duplicate:${keeper.id}:${dismiss.map((task) => task.id).sort().join(":")}`,
        kind: "duplicate",
        title: `Keep “${keeper.text}”`,
        reason: `${dismiss.length} repeated ${dismiss.length === 1 ? "task" : "tasks"} can be archived safely.`,
        company: keeper.company_id
          ? companyNames.get(keeper.company_id) || null
          : null,
        companyId: keeper.company_id,
        taskIds: dismiss.map((task) => task.id),
        taskTitles: dismiss.map((task) => task.text),
        keepTaskId: keeper.id,
        safeToApply: true,
        ageDays: oldestAge,
      });
    }
  }

  for (const task of tasks) {
    if (duplicateIds.has(task.id)) continue;
    const ageDays = ageInDays(task.created_at, nowMs);
    const pinned = task.payload?.pinned === true;
    const revenue = Boolean(task.company_id && revenueCompanies.has(task.company_id));
    const company = task.company_id
      ? companyNames.get(task.company_id) || null
      : null;
    const common = {
      company,
      companyId: task.company_id,
      taskIds: [task.id],
      taskTitles: [task.text],
      keepTaskId: task.id,
      ageDays,
    };

    if (
      ageDays >= 60 &&
      !task.company_id &&
      !task.due_at &&
      !pinned &&
      task.kind !== "counterparty_commitment"
    ) {
      suggestions.push({
        id: `stale:${task.id}`,
        kind: "stale",
        title: task.text,
        reason: `Loose task with no deadline or client, untouched for ${ageDays} days.`,
        ...common,
        keepTaskId: null,
        safeToApply: true,
      });
      continue;
    }

    if (task.kind === "counterparty_commitment" && ageDays >= 21) {
      suggestions.push({
        id: `waiting:${task.id}`,
        kind: "waiting",
        title: task.text,
        reason: `Still marked as waiting after ${ageDays} days. Confirm whether to chase, complete or dismiss it.`,
        ...common,
        safeToApply: false,
      });
      continue;
    }

    if (
      ageDays >= 14 &&
      !task.due_at &&
      !pinned &&
      task.company_id &&
      (revenue || task.kind === "commitment" || task.kind === "next_step")
    ) {
      suggestions.push({
        id: `needs_date:${task.id}`,
        kind: "needs_date",
        title: task.text,
        reason: `Important linked task has had no deadline for ${ageDays} days.`,
        ...common,
        safeToApply: false,
      });
    }
  }

  const order: Record<WorkCleanupSuggestion["kind"], number> = {
    duplicate: 0,
    stale: 1,
    needs_date: 2,
    waiting: 3,
  };
  suggestions.sort((a, b) => order[a.kind] - order[b.kind] || b.ageDays - a.ageDays);
  return summary(suggestions);
}
