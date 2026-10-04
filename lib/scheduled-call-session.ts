const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Scheduled calls use one stable LiveCoach session in the background worker and
 * in the browser. This lets somebody open the call workspace after the
 * notetaker has already joined and recover the same transcript and coaching
 * session instead of creating a second room.
 */
export function scheduledCallSessionId(upcomingId: unknown): string | null {
  if (typeof upcomingId !== "string" || !UUID.test(upcomingId)) return null;
  return `lc-scheduled-${upcomingId.toLowerCase()}`;
}
