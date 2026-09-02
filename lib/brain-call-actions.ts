export type BrainCallActionCandidate = {
  id: string;
  title?: string | null;
  scheduled_at?: string | null;
  attendees?: Array<{ name?: string | null; email?: string | null }> | null;
};

const LONDON_TIME_ZONE = "Europe/London";
const CALL_REFERENCE_STOP_WORDS = new Set([
  "call",
  "meeting",
  "with",
  "today",
  "tomorrow",
  "monday",
  "mon",
  "tuesday",
  "tue",
  "wednesday",
  "wed",
  "thursday",
  "thu",
  "friday",
  "fri",
  "saturday",
  "sat",
  "sunday",
  "sun",
  "january",
  "jan",
  "february",
  "feb",
  "march",
  "mar",
  "april",
  "apr",
  "may",
  "june",
  "jun",
  "july",
  "jul",
  "august",
  "aug",
  "september",
  "sept",
  "sep",
  "october",
  "oct",
  "november",
  "nov",
  "december",
  "dec",
]);

const MONTH_BY_NAME: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAY_BY_NAME: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const normalise = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const londonParts = (value: Date | string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: LONDON_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: String(parts.weekday || "").slice(0, 3).toLowerCase(),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
};

const addLondonDays = (date: Date, days: number) => {
  const current = londonParts(date);
  const shifted = new Date(
    Date.UTC(current.year, current.month - 1, current.day + days, 12)
  );
  return londonParts(shifted);
};

type RequestedDate = { year?: number; month: number; day: number };

function requestedDate(reference: string, now: Date): RequestedDate | null {
  const value = normalise(reference);
  if (/\btomorrow\b/.test(value)) {
    const next = addLondonDays(now, 1);
    return { year: next.year, month: next.month, day: next.day };
  }
  if (/\btoday\b/.test(value)) {
    const today = londonParts(now);
    return { year: today.year, month: today.month, day: today.day };
  }
  const iso = value.match(/\b(20\d{2})[ -](\d{1,2})[ -](\d{1,2})\b/);
  if (iso)
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

  const dayMonth = value.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|sept(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/
  );
  if (dayMonth) {
    const month = MONTH_BY_NAME[dayMonth[2]];
    if (month)
      return {
        ...(dayMonth[3] ? { year: Number(dayMonth[3]) } : {}),
        month,
        day: Number(dayMonth[1]),
      };
  }

  const weekdayMatch = value.match(
    /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/
  );
  if (!weekdayMatch) return null;
  const target = WEEKDAY_BY_NAME[weekdayMatch[1]];
  if (target == null) return null;
  const today = londonParts(now);
  const currentWeekday = WEEKDAY_BY_NAME[today.weekday];
  const offset = (target - currentWeekday + 7) % 7;
  const requested = addLondonDays(now, offset);
  return {
    year: requested.year,
    month: requested.month,
    day: requested.day,
  };
}

type RequestedClock = { hour: number; minute: number; twelveHour: boolean };

function requestedClock(reference: string): RequestedClock | null {
  // Keep clock punctuation here. The general text normaliser deliberately
  // removes colons, which would turn an exact `10:00` request into a date-only
  // match and could select the wrong meeting when two calls share a date.
  const value = String(reference || "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withMinutes = value.match(/\b(\d{1,2})[.:](\d{2})\s*(am|pm)?\b/);
  const hourOnly = value.match(/\b(\d{1,2})\s*(am|pm)\b/);
  const oClock = value.match(/\b(\d{1,2})\s+o\s+clock\b/);
  const match = withMinutes || hourOnly || oClock;
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = withMinutes ? Number(match[2]) : 0;
  const suffix = withMinutes ? match[3] : hourOnly ? match[2] : undefined;
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return {
    hour,
    minute,
    // A punctuated UK time such as 10:00 uses the 24-hour clock. Only an
    // unsuffixed spoken "10 o'clock" remains AM or PM ambiguous.
    twelveHour: Boolean(oClock && !suffix),
  };
}

function dateMatches(call: BrainCallActionCandidate, requested: RequestedDate) {
  if (!call.scheduled_at) return false;
  const actual = londonParts(call.scheduled_at);
  return (
    actual.month === requested.month &&
    actual.day === requested.day &&
    (requested.year == null || actual.year === requested.year)
  );
}

function clockMatches(call: BrainCallActionCandidate, requested: RequestedClock) {
  if (!call.scheduled_at) return false;
  const actual = londonParts(call.scheduled_at);
  const hourMatches = requested.twelveHour
    ? actual.hour % 12 === requested.hour % 12
    : actual.hour === requested.hour;
  return hourMatches && actual.minute === requested.minute;
}

function referenceWords(value: string): string[] {
  return Array.from(
    new Set(
      normalise(value)
        .split(" ")
        .filter(
          (word) =>
            word.length >= 3 &&
            !/^\d+$/.test(word) &&
            !CALL_REFERENCE_STOP_WORDS.has(word)
        )
    )
  );
}

function textScore(call: BrainCallActionCandidate, reference: string): number {
  const title = normalise(call.title);
  const normalisedReference = normalise(reference);
  const attendees = Array.isArray(call.attendees) ? call.attendees : [];
  const haystack = normalise(
    [
      call.title,
      ...attendees.map((attendee) => `${attendee?.name || ""} ${attendee?.email || ""}`),
    ].join(" ")
  );
  let score =
    title && ` ${normalisedReference} `.includes(` ${title} `) ? 30 : 0;
  for (const word of referenceWords(reference)) {
    if (haystack.split(" ").includes(word)) score += word.length >= 5 ? 6 : 4;
  }
  return score;
}

export function resolveBrainCallActionCandidates<T extends BrainCallActionCandidate>(
  calls: T[],
  reference: string,
  now = new Date()
): T[] {
  if (!normalise(reference)) return [];
  const requestedCallDate = requestedDate(reference, now);
  const requestedCallClock = requestedClock(reference);
  let eligible = calls.filter(
    (call) => call?.id && call.scheduled_at && Number.isFinite(new Date(call.scheduled_at).getTime())
  );

  if (requestedCallDate) {
    eligible = eligible.filter((call) => dateMatches(call, requestedCallDate));
    if (!eligible.length) return [];
  }
  if (requestedCallClock) {
    eligible = eligible.filter((call) => clockMatches(call, requestedCallClock));
    if (!eligible.length) return [];
  }

  const nowMs = now.getTime();
  const ranked = eligible
    .map((call) => {
      const identityScore = textScore(call, reference);
      return {
        call,
        identityScore,
        score:
          identityScore +
          (new Date(call.scheduled_at as string).getTime() >= nowMs ? 3 : -1),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        new Date(left.call.scheduled_at as string).getTime() -
          new Date(right.call.scheduled_at as string).getTime()
    );
  if (!ranked.length) return [];

  const topScore = ranked[0].score;
  const hasExactSchedule = Boolean(requestedCallDate || requestedCallClock);
  if (!hasExactSchedule && topScore < 4) return [];
  if (
    hasExactSchedule &&
    referenceWords(reference).length > 0 &&
    ranked[0].identityScore === 0
  )
    return [];
  return ranked
    .filter((row) => row.score >= topScore - 1)
    .map((row) => row.call);
}

const cleanFocusText = (value: unknown, max = 1000) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

const includesFocus = (items: string[], note: string) => {
  const wanted = normalise(note);
  return items.some((item) => normalise(item) === wanted);
};

export function appendBrainCallFocusNote(
  currentIntent: unknown,
  currentPrep: unknown,
  requestedNote: unknown
) {
  const note = cleanFocusText(requestedNote);
  const intent = String(currentIntent || "").trim();
  const intentAlreadyIncludesNote =
    Boolean(note) && normalise(intent).includes(normalise(note));
  const nextIntent = !note || intentAlreadyIncludesNote
    ? intent
    : intent
      ? `${intent}\n\n${note}`
      : note;
  const prep = currentPrep && typeof currentPrep === "object"
    ? { ...(currentPrep as Record<string, any>) }
    : {};
  const suggestedComps = Array.isArray(prep.suggestedComps)
    ? prep.suggestedComps.filter(
        (item: unknown): item is string =>
          typeof item === "string" && Boolean(item.trim())
      )
    : [];
  const selectedComps = Array.isArray(prep.selectedComps)
    ? prep.selectedComps.filter(
        (item: unknown): item is string =>
          typeof item === "string" && Boolean(item.trim())
      )
    : [];
  const suggestedAlreadyIncludesNote = !note || includesFocus(suggestedComps, note);
  const selectedAlreadyIncludesNote = !note || includesFocus(selectedComps, note);
  if (!suggestedAlreadyIncludesNote) suggestedComps.push(note);
  if (!selectedAlreadyIncludesNote) selectedComps.push(note);

  return {
    note,
    intent: nextIntent,
    prep: {
      ...prep,
      brief: nextIntent,
      focusBasisBrief: nextIntent,
      suggestedComps,
      selectedComps,
      planStage: prep.planStage === "full" ? "full" : "focus",
    },
    intentChanged: nextIntent !== intent,
    focusAdded:
      !suggestedAlreadyIncludesNote || !selectedAlreadyIncludesNote,
  };
}
