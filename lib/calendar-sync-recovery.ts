export function shouldReopenScheduledCalendarCall(input: {
  scheduledAt: unknown;
  completedAt: unknown;
  nowMs?: number;
}): boolean {
  if (!input.completedAt) return false;
  const scheduledMs = new Date(String(input.scheduledAt || "")).getTime();
  const nowMs = input.nowMs ?? Date.now();
  return Number.isFinite(scheduledMs) && scheduledMs > nowMs;
}
