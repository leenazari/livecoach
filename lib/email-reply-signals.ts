export type OutOfOfficeSignal = {
  isOutOfOffice: boolean;
  returnDate: string | null;
  summary: string;
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const OOO_SIGNAL = /\b(?:automatic\s+(?:reply|response)|auto[ -]?reply|out\s+of\s+(?:the\s+)?office|away\s+from\s+(?:the\s+)?office|currently\s+(?:away|on\s+(?:annual\s+)?leave)|on\s+(?:annual\s+)?leave|limited\s+access\s+to\s+(?:my\s+)?email|not\s+checking\s+(?:my\s+)?emails?)\b/i;
const RETURN_PREFIX = /\b(?:back|return(?:ing)?|available)\s+(?:in\s+the\s+office\s+)?(?:on|from)?\s*|\b(?:away|out\s+of\s+(?:the\s+)?office|on\s+(?:annual\s+)?leave)\s+until\s+/i;

const validIso = (year: number, month: number, day: number) => {
  const candidate = new Date(Date.UTC(year, month, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month ||
    candidate.getUTCDate() !== day
  ) return null;
  return candidate.toISOString().slice(0, 10);
};

const inferredYear = (
  year: number | null,
  month: number,
  day: number,
  receivedAt: Date
) => {
  if (year !== null) return year < 100 ? 2000 + year : year;
  let candidateYear = receivedAt.getUTCFullYear();
  const candidate = Date.UTC(candidateYear, month, day);
  if (candidate < receivedAt.getTime() - 2 * 86400000) candidateYear += 1;
  return candidateYear;
};

const parseExplicitDate = (value: string, receivedAt: Date): string | null => {
  const cleaned = value
    .toLowerCase()
    .trim();

  const dayFirst = cleaned.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*(\d{2,4}))?\b/i
  );
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    const day = Number(dayFirst[1]);
    const year = inferredYear(dayFirst[3] ? Number(dayFirst[3]) : null, month, day, receivedAt);
    return validIso(year, month, day);
  }

  const monthFirst = cleaned.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{2,4}))?\b/i
  );
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = inferredYear(monthFirst[3] ? Number(monthFirst[3]) : null, month, day, receivedAt);
    return validIso(year, month, day);
  }

  const numeric = cleaned.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = inferredYear(Number(numeric[3]), month, day, receivedAt);
    return validIso(year, month, day);
  }

  const weekday = cleaned.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  if (weekday) {
    const target = WEEKDAYS[weekday[1].toLowerCase()];
    const start = new Date(Date.UTC(
      receivedAt.getUTCFullYear(),
      receivedAt.getUTCMonth(),
      receivedAt.getUTCDate()
    ));
    let days = (target - start.getUTCDay() + 7) % 7;
    if (days === 0) days = 7;
    start.setUTCDate(start.getUTCDate() + days);
    return start.toISOString().slice(0, 10);
  }

  return null;
};

const explicitReturnDate = (value: string, receivedAt: Date) => {
  const prefix = RETURN_PREFIX.exec(value);
  if (!prefix) return null;
  return parseExplicitDate(value.slice(prefix.index + prefix[0].length, prefix.index + prefix[0].length + 80), receivedAt);
};

export function detectOutOfOffice(input: {
  subject?: string;
  freshText?: string;
  autoSubmitted?: string;
  receivedAt?: string;
}): OutOfOfficeSignal {
  const subject = String(input.subject || "");
  const freshText = String(input.freshText || "");
  const combined = `${subject}\n${freshText}`.slice(0, 7000);
  const isOutOfOffice = OOO_SIGNAL.test(combined);
  if (!isOutOfOffice) {
    return { isOutOfOffice: false, returnDate: null, summary: "" };
  }

  const parsedReceived = new Date(input.receivedAt || "");
  const receivedAt = Number.isFinite(parsedReceived.getTime())
    ? parsedReceived
    : new Date();
  const returnDate = explicitReturnDate(combined, receivedAt);
  const summary = returnDate
    ? `Out of office until ${new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(`${returnDate}T00:00:00Z`))}.`
    : "Out of office reply received.";
  return { isOutOfOffice: true, returnDate, summary };
}
