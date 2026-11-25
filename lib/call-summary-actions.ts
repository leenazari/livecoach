// Preserve every extracted request. Short summaries and UI previews must not
// silently cap the canonical action register at twelve entries.
export function normalizeCallSummaryActions(value: unknown, canonicalOwner: (name: string) => string | null) {
  if (!Array.isArray(value)) return [];
  return value.filter(a => a && typeof a.text === "string" && a.text.trim()).map(a => {
    const raw = typeof a.owner === "string" ? a.owner.trim() : "";
    return {
      owner: !raw || /^unassigned$/i.test(raw) ? "Unassigned" : canonicalOwner(raw) || "Unassigned",
      text: a.text.trim(),
    };
  });
}
