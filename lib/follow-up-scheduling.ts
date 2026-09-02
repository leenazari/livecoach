const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ZONED_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

export function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Native date and time controls use the browser's local timezone. Convert the
// chosen wall-clock time to a zoned ISO value before it reaches the server, so
// a 14:30 reminder remains 14:30 for that salesperson through DST changes.
export function followUpAtFromLocalParts(
  date: string,
  time: string
): string | null {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute
  ) {
    return null;
  }
  return local.toISOString();
}

export function normaliseFollowUpAt(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!ZONED_DATE_TIME_PATTERN.test(raw)) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function followUpAtIsPast(
  iso: string,
  now = new Date(),
  toleranceMs = 60_000
): boolean {
  return new Date(iso).getTime() < now.getTime() - toleranceMs;
}
