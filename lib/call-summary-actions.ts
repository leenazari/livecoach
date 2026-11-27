import { validTopRequestIndices } from "./call-top-requests";

// Preserve every extracted request. Short summaries and UI previews must not
// silently cap the canonical action register at twelve entries.
export function normalizeCallSummaryActions(value: unknown, canonicalOwner: (name: string) => string | null, topActionIndices?: unknown) {
  if (!Array.isArray(value)) return [];
  const textOf = (action: any) => typeof action?.text === "string" ? action.text : "";
  const ranked = validTopRequestIndices(topActionIndices, value, textOf) ? topActionIndices : [];
  return value.flatMap((a, index) => {
    if (!textOf(a).trim()) return [];
    const raw = typeof a.owner === "string" ? a.owner.trim() : "";
    const position = ranked.indexOf(index);
    return [{
      owner: !raw || /^unassigned$/i.test(raw) ? "Unassigned" : canonicalOwner(raw) || "Unassigned",
      text: a.text.trim(),
      ...(position < 0 ? {} : { topRequestRank: position + 1 }),
    }];
  });
}
