const normalTitle = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[()\[\]{}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// These are personal reminders, location or availability blocks, not
// conversations. Keep the match deliberately narrow so a real title such as
// "Meeting with Andrew in the office" is not hidden merely because it contains
// one of these words.
const NON_MEETING_BLOCKS = new Set([
  "office",
  "in office",
  "office day",
  "working from office",
  "working from the office",
  "wfh",
  "working from home",
  "home working",
  "out of office",
  "annual leave",
  "holiday",
  "travel",
  "commute",
  "focus time",
  "football",
  "bandages football",
]);

export function isNonMeetingCalendarBlock(title: unknown): boolean {
  return NON_MEETING_BLOCKS.has(normalTitle(title));
}

export function isPrepEligibleCalendarEvent(event: { title?: unknown }): boolean {
  return !isNonMeetingCalendarBlock(event?.title);
}

const LONDON_SYNC_HOURS = new Set([9, 12, 15, 18, 21]);

export function scheduledCalendarSyncDecision(now = new Date()): {
  run: boolean;
  weekday: string;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const weekend = weekday === "Saturday" || weekday === "Sunday";
  return {
    run: weekend ? hour === 9 : LONDON_SYNC_HOURS.has(hour),
    weekday,
    hour,
  };
}
