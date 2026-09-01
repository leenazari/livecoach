export const OUTREACH_DAILY_HARD_LIMIT = 50;
export const OUTREACH_DEFAULT_DAILY_LIMIT = 50;

export function clampOutreachDailyLimit(
  value: unknown,
  fallback = OUTREACH_DEFAULT_DAILY_LIMIT
): number {
  const parsed = Number(value);
  const candidate = Number.isFinite(parsed) && parsed !== 0
    ? Math.floor(parsed)
    : fallback;
  return Math.min(OUTREACH_DAILY_HARD_LIMIT, Math.max(1, candidate));
}
