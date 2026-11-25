const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Scheduled occurrences use one stable LiveCoach session in the background worker and
 * in the browser. This lets somebody open the call workspace after the
 * notetaker has already joined and recover the same transcript and coaching
 * session instead of creating a second room.
 *
 * Include the calendar time so moving a previously completed/no-show event
 * cannot reuse its old transcript, recap or live-coaching room. The legacy
 * form is retained only for older bookmarked clients during rollout.
 */
export function scheduledCallSessionId(upcomingId: unknown, scheduledAt?: unknown): string | null {
  if (typeof upcomingId !== "string" || !UUID.test(upcomingId)) return null;
  const base = `lc-scheduled-${upcomingId.toLowerCase()}`;
  if (scheduledAt === undefined) return base;
  const at = typeof scheduledAt === "string" ? Date.parse(scheduledAt) : NaN;
  return Number.isFinite(at) ? `${base}-${at.toString(36)}` : null;
}
