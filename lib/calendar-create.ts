export const CALENDAR_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export type CalendarRecurrenceFrequency = "daily" | "weekly" | "monthly";
export type CalendarWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type CalendarRecurrence = {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  count: number;
  weekdays: CalendarWeekday[];
};

const WEEKDAYS: CalendarWeekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const GOOGLE_WEEKDAY: Record<CalendarWeekday, string> = {
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
  sunday: "SU",
};

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

function londonParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A valid event time is required");
  const entries = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return entries as Record<string, string>;
}

export function londonCalendarDate(value: string): string {
  const parts = londonParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function microsoftLondonDateTime(value: string): string {
  const parts = londonParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function londonWeekday(value: string): CalendarWeekday {
  const name = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
  })
    .format(new Date(value))
    .toLowerCase();
  if (!WEEKDAYS.includes(name as CalendarWeekday)) {
    throw new Error("A valid recurrence weekday is required");
  }
  return name as CalendarWeekday;
}

export function calendarRecurrence(
  value: unknown,
  startIso: string
): CalendarRecurrence | null {
  if (value == null || value === false) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Choose a valid calendar recurrence");
  }
  const input = value as Record<string, unknown>;
  const frequency = String(input.frequency || "").toLowerCase();
  if (!(["daily", "weekly", "monthly"] as string[]).includes(frequency)) {
    throw new Error("Choose a valid daily, weekly or monthly recurrence");
  }
  const interval = Math.round(Number(input.interval || 1));
  const count = Math.round(Number(input.count || input.occurrences || 0));
  if (!Number.isFinite(interval) || interval < 1 || interval > 12) {
    throw new Error("Choose a valid recurrence interval from 1 to 12");
  }
  if (!Number.isFinite(count) || count < 2 || count > 52) {
    throw new Error("Choose between 2 and 52 calendar occurrences");
  }
  const suppliedWeekdays = Array.isArray(input.weekdays)
    ? input.weekdays
        .map((day) => String(day || "").trim().toLowerCase())
        .filter((day): day is CalendarWeekday =>
          WEEKDAYS.includes(day as CalendarWeekday)
        )
    : [];
  const weekdays =
    frequency === "weekly"
      ? Array.from(new Set(suppliedWeekdays.length ? suppliedWeekdays : [londonWeekday(startIso)]))
      : [];
  return {
    frequency: frequency as CalendarRecurrenceFrequency,
    interval,
    count,
    weekdays,
  };
}

export function googleCalendarRecurrenceRule(
  recurrence: CalendarRecurrence,
  startIso: string
): string {
  const parts = [
    `FREQ=${recurrence.frequency.toUpperCase()}`,
    `INTERVAL=${recurrence.interval}`,
    `COUNT=${recurrence.count}`,
  ];
  if (recurrence.frequency === "weekly") {
    parts.push(`BYDAY=${recurrence.weekdays.map((day) => GOOGLE_WEEKDAY[day]).join(",")}`);
  }
  if (recurrence.frequency === "monthly") {
    parts.push(`BYMONTHDAY=${Number(londonCalendarDate(startIso).slice(-2))}`);
  }
  return `RRULE:${parts.join(";")}`;
}

export function microsoftCalendarRecurrence(
  recurrence: CalendarRecurrence,
  startIso: string
) {
  const startDate = londonCalendarDate(startIso);
  const dayOfMonth = Number(startDate.slice(-2));
  return {
    pattern:
      recurrence.frequency === "monthly"
        ? {
            type: "absoluteMonthly",
            interval: recurrence.interval,
            dayOfMonth,
          }
        : recurrence.frequency === "weekly"
          ? {
              type: "weekly",
              interval: recurrence.interval,
              daysOfWeek: recurrence.weekdays,
              firstDayOfWeek: "monday",
            }
          : { type: "daily", interval: recurrence.interval },
    range: {
      type: "numbered",
      startDate,
      numberOfOccurrences: recurrence.count,
      recurrenceTimeZone: "GMT Standard Time",
    },
  };
}
