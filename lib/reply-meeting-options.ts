// Calendar suggestions contain availability only, never calendar titles or attendees.
export type ReplyMeetingRequest = {
  requested: boolean;
  durationMinutes: number;
  fromDate: string | null;
  toDate: string | null;
  weekdays: number[];
  timeOfDay: "any" | "morning" | "afternoon";
  clarification: string | null;
};
export type ReplyMeetingOptions = {
  checkedAt: string;
  timezone: string;
  calendarAccountKeys: string[];
  status: "available" | "unavailable" | "no_slots" | "clarify";
  note: string;
  request: ReplyMeetingRequest;
  slots: { start: string; end: string; label: string }[];
};

const MINUTE = 60_000;
export const MEETING_OPTIONS_MARKER = "[[MEETING_OPTIONS]]";
const isoDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};
export function normaliseReplyMeetingRequest(value: any): ReplyMeetingRequest {
  const duration = Number(value?.durationMinutes);
  const invalid = (value?.fromDate != null && !isoDate(value.fromDate)) ||
    (value?.toDate != null && !isoDate(value.toDate)) ||
    (value?.durationMinutes != null && (!Number.isInteger(duration) || duration < 10 || duration > 120)) ||
    (value?.timeOfDay != null && !["any", "morning", "afternoon"].includes(value.timeOfDay)) ||
    (value?.weekdays != null && (!Array.isArray(value.weekdays) || value.weekdays.some((day: unknown) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 7)));
  return {
    requested: value?.requested === true,
    durationMinutes: Number.isInteger(duration) && duration >= 10 && duration <= 120 ? duration : 30,
    fromDate: isoDate(value?.fromDate),
    toDate: isoDate(value?.toDate),
    weekdays: Array.isArray(value?.weekdays)
      ? [...new Set<number>(value.weekdays.filter((day: unknown) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7))]
      : [],
    timeOfDay: ["morning", "afternoon"].includes(value?.timeOfDay) ? value.timeOfDay : "any",
    clarification: invalid ? "Confirm the requested meeting dates, duration and working window." : typeof value?.clarification === "string" ? value.clarification.trim().slice(0, 250) || null : null,
  };
}

export function localClock(instant: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday")) + 1,
  };
}

function dateTime(value: any, timezone: string): number {
  const raw = String(value?.dateTime || "");
  if (raw && /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return Date.parse(raw);
  // Google date-only events are local midnight, not UTC. Resolve through the
  // calendar timezone so DST and calendars outside the user's timezone work.
  const local = value?.date ? `${value.date}T00:00:00` : raw;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) return NaN;
  const target = Date.parse(`${local.replace(/\.\d+$/, "")}Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const clock = localClock(guess, value?.timeZone || timezone);
    const seen = Date.parse(`${clock.date}T00:00:00Z`) + clock.minutes * MINUTE;
    guess += target - seen;
  }
  return guess;
}

export function busyIntervals(events: any[], timezone: string): { start: number; end: number }[] {
  return events.flatMap(event => {
    if (event.status === "cancelled" || event.transparency === "transparent" ||
        event.attendees?.some((person: any) => person.self && person.responseStatus === "declined")) return [];
    const zone = event.calendar_timezone || timezone;
    const start = dateTime(event.start, zone), end = dateTime(event.end, zone);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("A calendar entry has no reliable start and end time");
    }
    return [{ start, end }];
  });
}

export function chooseReplyMeetingSlots(input: {
  events: any[]; timezone: string; workdayStart: string; workdayEnd: string;
  request: ReplyMeetingRequest; now: number; until: number;
}): ReplyMeetingOptions["slots"] {
  const busy = busyIntervals(input.events, input.timezone);
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const workStart = toMinutes(input.workdayStart), workEnd = toMinutes(input.workdayEnd);
  const duration = input.request.durationMinutes * MINUTE;
  const candidates: (ReplyMeetingOptions["slots"][number] & { date: string })[] = [];
  const startAt = Math.ceil((input.now + 60 * MINUTE) / (15 * MINUTE)) * 15 * MINUTE;
  for (let start = startAt; start + duration <= input.until; start += 15 * MINUTE) {
    const clock = localClock(start, input.timezone);
    const endClock = localClock(start + duration, input.timezone);
    const weekdays = input.request.weekdays.length ? input.request.weekdays : [1, 2, 3, 4, 5];
    if (!weekdays.includes(clock.weekday) || clock.minutes < workStart ||
        endClock.minutes > workEnd || clock.date !== endClock.date ||
        (input.request.fromDate && clock.date < input.request.fromDate) ||
        (input.request.toDate && clock.date > input.request.toDate) ||
        (input.request.timeOfDay === "morning" && endClock.minutes > 12 * 60) ||
        (input.request.timeOfDay === "afternoon" && clock.minutes < 12 * 60) ||
        busy.some(event => start < event.end + 15 * MINUTE && start + duration > event.start - 15 * MINUTE)) continue;
    const label = new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(start);
    candidates.push({ start: new Date(start).toISOString(), end: new Date(start + duration).toISOString(), label, date: clock.date });
  }
  if (!candidates.length) return [];
  // Earliest suitable options with a choice of days, not adjacent 15-minute slots.
  const first = candidates[0];
  const second = candidates.find(slot => slot.date !== first.date) ||
    candidates.find(slot => Date.parse(slot.start) >= Date.parse(first.end) + 60 * MINUTE);
  return [first, ...(second ? [second] : [])].map(({ date: _date, ...slot }) => slot);
}

export function meetingOptionsParagraph(options: ReplyMeetingOptions): string {
  if (options.status !== "available" || !options.slots.length) {
    return options.status === "clarify"
      ? "Could you confirm your preferred date, time and timezone so we can arrange a suitable time?"
      : "What dates and times would work for you? I will check my diary before confirming.";
  }
  return `Would ${options.slots.map(slot => slot.label).join(" or ")} work for a ${options.request.durationMinutes}-minute meeting? These times are in ${options.timezone}. Please let me know which suits you. Nothing is booked yet.`;
}

export function insertMeetingOptions(body: string, options: ReplyMeetingOptions | null): string {
  if (!options) return body.split(MEETING_OPTIONS_MARKER).join("").trim();
  const paragraph = meetingOptionsParagraph(options);
  if (body.includes(MEETING_OPTIONS_MARKER)) {
    let added = false;
    return body.split(MEETING_OPTIONS_MARKER).map((part, index) => {
      if (!index || added) return part;
      added = true;
      return paragraph + part;
    }).join("").trim();
  }
  return `${body.trim()}\n\n${paragraph}`;
}
