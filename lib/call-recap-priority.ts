// Presentation only. Never persist a guessed deadline or create a task from a
// traffic light. Relative dates stay anchored to the call, even on a later retry.
const DAY = 86_400_000;
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function londonDay(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
}
function calendarDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date.getTime() / DAY : null;
}
export type RecapPriority = { colour: "red" | "amber" | "green"; label: string; rank: number; day: number | null };
export function callRecapPriority(due: string | null | undefined, meetingAt: string, now: string): RecapPriority | null {
  if (!due) return null;
  const sourceDay = londonDay(meetingAt), today = londonDay(now);
  if (sourceDay === null || today === null) return null;
  const text = due.trim().toLowerCase().replace(/^(?:due\s+)?(?:by|on|before)\s+/, "").replace(/[.,]$/, "").trim();
  if (/^(?:asap|as soon as possible|immediately|urgent)$/.test(text)) return { colour: "red", label: "Urgent", rank: 0, day: null };
  let day: number | null = null;
  const relative = text.match(/^(today|tonight|tomorrow)(?:\s+(?:morning|afternoon|evening))?$/);
  const weekday = text.match(/^(?:this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const named = text.match(/^(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(20\d{2}))?(?:,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s+europe\/london)?)?$/);
  if (relative) day = sourceDay + (relative[1] === "tomorrow" ? 1 : 0);
  else if (weekday) {
    const offset = weekdays.indexOf(weekday[1]) - new Date(sourceDay * DAY).getUTCDay();
    if (!text.startsWith("this ") || offset >= 0) day = sourceDay + (offset + 7) % 7;
  } else if (iso) day = calendarDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (named && months.includes(named[2])) {
    const year = named[3] ? Number(named[3]) : new Date(sourceDay * DAY).getUTCFullYear();
    day = calendarDay(year, months.indexOf(named[2]), Number(named[1]));
    if (!named[3] && day !== null && day < sourceDay) day = null;
  }
  // Unclear phrases such as next week, when possible or a numeric locale-
  // dependent date remain uncoloured, not falsely labelled low priority.
  if (day === null) return null;
  const distance = day - today;
  if (distance <= 0) return { colour: "red", label: distance < 0 ? "Overdue" : "Due today", rank: 0, day };
  if (distance <= 7) return { colour: "amber", label: "Upcoming", rank: 1, day };
  return { colour: "green", label: "Later", rank: 2, day };
}
