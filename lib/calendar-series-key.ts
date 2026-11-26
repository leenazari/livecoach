// Google stores expanded instances as <recurringEventId>_<original UTC start>.
// Match only that provider format, never the meeting title or join link.
export function googleCalendarSeriesKey(source: unknown, externalId: unknown) {
  if (source !== "google" || typeof externalId !== "string") return null;
  return /^([a-zA-Z0-9_-]{1,512})_\d{8}T\d{6}Z$/.exec(externalId)?.[1] || null;
}

export function googleCalendarSeriesPattern(key: string) {
  return key.replace(/_/g, "\\_") + "\\_%";
}
