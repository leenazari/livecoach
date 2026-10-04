export const PRECALL_LEAD_MS = 5 * 60 * 1000;

export function precallJoinAt(scheduledAt: unknown, nowMs = Date.now()) {
  const start = typeof scheduledAt === "string" ? Date.parse(scheduledAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const joinAt = start - PRECALL_LEAD_MS;
  return joinAt > nowMs + 30_000 ? new Date(joinAt).toISOString() : null;
}

export function precallScheduleAction(input: {
  scheduledAt: unknown;
  completed: boolean;
  supportedLink: boolean;
  nowMs?: number;
}) {
  if (input.completed || !input.supportedLink) return "cancel" as const;
  const start = typeof input.scheduledAt === "string"
    ? Date.parse(input.scheduledAt)
    : NaN;
  if (!Number.isFinite(start)) return "cancel" as const;
  // Clear any obsolete future reservation after an event moves into the past.
  // The cancellation helper protects captures that are already in progress.
  if (start < (input.nowMs ?? Date.now()) - 2 * 60 * 1000) return "cancel" as const;
  // Reserve the rolling next week, refreshed by normal calendar sync. This
  // avoids hundreds of unused provider reservations for distant recurrences.
  if (start > (input.nowMs ?? Date.now()) + 7 * 86400000) return "cancel" as const;
  return "schedule" as const;
}
