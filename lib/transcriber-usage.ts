export const TRANSCRIBER_DAILY_LIMIT_DEFAULT = 360;
export const TRANSCRIBER_DAILY_LIMIT_MIN = 30;
export const TRANSCRIBER_DAILY_LIMIT_MAX = 720;
export const TRANSCRIBER_HARD_LIMIT_SECONDS = 3 * 60 * 60;

export type TranscriberUsageRow = {
  owner_id: string;
  created_at: string;
  ended_at: string | null;
  status: string;
};

export type TranscriberUsage = {
  usedSeconds: number;
  usedMinutes: number;
  remainingSeconds: number;
  remainingMinutes: number;
  dailyLimitMinutes: number;
  activeBot: boolean;
  botCount: number;
};

const LONDON_TIME_ZONE = "Europe/London";
const londonDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const londonDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function numericParts(formatter: Intl.DateTimeFormat, value: Date) {
  return Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>;
}

function londonMidnightUtc(year: number, month: number, day: number) {
  const desiredUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = desiredUtc;
  // Two passes handle the offset transition around British Summer Time.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = numericParts(
      londonDateTimeFormatter,
      new Date(candidate)
    );
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    candidate = desiredUtc - (representedAsUtc - candidate);
  }
  return new Date(candidate);
}

export function londonDayBounds(now = new Date()) {
  const local = numericParts(londonDateFormatter, now);
  const nextCalendarDay = new Date(
    Date.UTC(local.year, local.month - 1, local.day + 1)
  );
  return {
    start: londonMidnightUtc(local.year, local.month, local.day),
    end: londonMidnightUtc(
      nextCalendarDay.getUTCFullYear(),
      nextCalendarDay.getUTCMonth() + 1,
      nextCalendarDay.getUTCDate()
    ),
  };
}

export function normaliseDailyTranscriberLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return TRANSCRIBER_DAILY_LIMIT_DEFAULT;
  return Math.min(
    TRANSCRIBER_DAILY_LIMIT_MAX,
    Math.max(TRANSCRIBER_DAILY_LIMIT_MIN, parsed)
  );
}

export function calculateTranscriberUsage(
  rows: TranscriberUsageRow[],
  ownerId: string,
  dailyLimitMinutes: number,
  now = new Date()
): TranscriberUsage {
  const { start, end } = londonDayBounds(now);
  const dayStart = start.getTime();
  const dayEnd = end.getTime();
  const nowMs = now.getTime();
  const hardLimitMs = TRANSCRIBER_HARD_LIMIT_SECONDS * 1000;
  const limit = normaliseDailyTranscriberLimit(dailyLimitMinutes);
  let usedMs = 0;
  let activeBot = false;
  let botCount = 0;

  for (const row of rows) {
    if (row.owner_id !== ownerId) continue;
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(created)) continue;
    const recordedEnd = row.ended_at ? Date.parse(row.ended_at) : nowMs;
    const effectiveEnd = Math.min(
      Number.isFinite(recordedEnd) ? recordedEnd : nowMs,
      created + hardLimitMs,
      nowMs
    );
    const overlapStart = Math.max(created, dayStart);
    const overlapEnd = Math.min(effectiveEnd, dayEnd);
    if (overlapEnd > overlapStart) {
      usedMs += overlapEnd - overlapStart;
      botCount += 1;
    }
    if (
      row.status === "active" &&
      !row.ended_at &&
      created + hardLimitMs > nowMs
    ) {
      activeBot = true;
    }
  }

  const usedSeconds = Math.ceil(usedMs / 1000);
  const limitSeconds = limit * 60;
  const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);
  return {
    usedSeconds,
    usedMinutes: Math.ceil(usedSeconds / 60),
    remainingSeconds,
    remainingMinutes: Math.floor(remainingSeconds / 60),
    dailyLimitMinutes: limit,
    activeBot,
    botCount,
  };
}
