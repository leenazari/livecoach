type MeetingItem = { type: string; at: string; href?: string; title: string };
const CALL_LINK = /^\/call\?upcoming=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Use the exact, account-scoped calendar entries already returned by the
// client's timeline. Never match a bot by company name or meeting URL alone.
export function clientScheduledCalls<T extends MeetingItem>(items: T[], now = Date.now()) {
  const calls = items.filter((item) => item.type === "meeting" && CALL_LINK.test(item.href || "")
    && Date.parse(item.at) >= now - 3 * 3600000);
  const current = calls.filter((item) => Date.parse(item.at) <= now + 60000)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const future = calls.filter((item) => Date.parse(item.at) > now + 60000)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // More than one plausible ongoing call needs a choice, not a guessed room.
  return { current, future, preferred: current.length === 1 ? current[0] : current.length ? null : future[0] || null };
}
