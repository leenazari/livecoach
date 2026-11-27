// A ranked view of the existing action register, never a second set of tasks.
const requestKey = (text: string) => text.trim().toLowerCase()
  .replace(/^(?:requested|agreed)\s*[—:.-]\s*/, "")
  .replace(/\s+/g, " ");

export function validTopRequestIndices<T>(value: unknown, actions: T[], textOf: (action: T) => string): value is number[] {
  if (!Array.isArray(value)) return false;
  const distinct = new Set(actions.map(textOf).filter(text => text.trim()).map(requestKey));
  return value.length === Math.min(5, distinct.size) &&
    value.every(index => Number.isInteger(index) && index >= 0 && index < actions.length && textOf(actions[index]).trim()) &&
    new Set(value.map(index => requestKey(textOf(actions[index])))).size === value.length;
}

export function topCallRequests<T extends { topRequestRank?: unknown }>(
  actions: T[],
  textOf: (action: T) => string,
  priorityOf?: (action: T) => { rank: number; day: number | null } | null,
): T[] {
  const rank = (action: T) => typeof action.topRequestRank === "number" &&
    Number.isInteger(action.topRequestRank) && action.topRequestRank >= 1 && action.topRequestRank <= 5
    ? action.topRequestRank : 6;
  // Cached, already-reviewed calls remain usable without paying to regenerate
  // them. Fall back to their evidenced deadlines and existing source order.
  const sorted = actions.map((action, index) => ({ action, index }))
    .filter(({ action }) => textOf(action).trim())
    .map(item => ({ ...item, priority: priorityOf?.(item.action) }))
    .sort((a, b) => rank(a.action) - rank(b.action) ||
      (a.priority?.rank ?? 3) - (b.priority?.rank ?? 3) ||
      (a.priority?.day ?? Infinity) - (b.priority?.day ?? Infinity) || a.index - b.index);
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const { action } of sorted) {
    const text = textOf(action);
    const key = requestKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(action);
    if (selected.length === 5) break;
  }
  return selected;
}

export const topRequestsHeading = (count: number) => count === 5 ? "Top five requests" : "Top requests";
