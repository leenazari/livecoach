export const CALENDAR_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCalendarAttendees(value: unknown): {
  emails: string[];
  invalid: string[];
} {
  const raw = Array.isArray(value)
    ? value.map((item) => String(item || ""))
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [];
  const unique = Array.from(
    new Set(raw.map((email) => email.trim().toLowerCase()).filter(Boolean))
  ).slice(0, 50);
  return {
    emails: unique.filter((email) => EMAIL_PATTERN.test(email)),
    invalid: unique.filter((email) => !EMAIL_PATTERN.test(email)),
  };
}

export function calendarDurationMinutes(value: unknown): number {
  const duration = Number(value);
  return CALENDAR_DURATION_OPTIONS.includes(
    duration as (typeof CALENDAR_DURATION_OPTIONS)[number]
  )
    ? duration
    : 30;
}

export function validCalendarRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

// Google accepts caller-supplied event IDs using base32hex characters. UUID
// hexadecimal characters are a safe subset, and keeping the browser request ID
// makes an accidental retry idempotent instead of creating a second meeting.
export function googleEventIdForRequest(requestId: string): string {
  if (!validCalendarRequestId(requestId)) {
    throw new Error("A valid calendar request ID is required");
  }
  return `lc${requestId.toLowerCase().replaceAll("-", "")}`;
}

export function microsoftUtcDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A valid event time is required");
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}
