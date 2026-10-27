export type FocusBuildMode = "focus" | "refocus";

export type FocusBuildResult = {
  callType?: string;
  subjectName?: string;
  character?: string;
  focusAreas?: unknown;
  additions?: unknown;
  upgrades?: unknown;
  reconcile?: boolean;
  degraded?: boolean;
};

type FocusUpgrade = { from: string; to: string };

const FOCUS_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "be",
  "its",
  "this",
  "that",
  "plus",
  "via",
  "into",
  "about",
  "new",
  "our",
  "their",
  "your",
]);

export function cleanFocusList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const label = item.trim();
    if (!result.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
      result.push(label);
    }
    if (result.length >= limit) break;
  }
  return result;
}

function cleanUpgrades(value: unknown): FocusUpgrade[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is FocusUpgrade =>
        !!item &&
        typeof item.from === "string" &&
        typeof item.to === "string" &&
        !!item.from.trim() &&
        !!item.to.trim()
    )
    .map((item) => ({ from: item.from.trim(), to: item.to.trim() }))
    .slice(0, 5);
}

function salientWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !FOCUS_STOP_WORDS.has(word))
  );
}

function isNearDuplicate(left: string, right: string): boolean {
  const a = salientWords(left);
  const b = salientWords(right);
  if (!a.size || !b.size) return false;
  let shared = 0;
  a.forEach((word) => {
    if (b.has(word)) shared += 1;
  });
  return shared >= 2 && shared / Math.min(a.size, b.size) >= 0.6;
}

function mergeReconciled(
  current: string[],
  additions: string[],
  upgrades: FocusUpgrade[]
): string[] {
  const upgraded = current.map((label) => {
    const match = upgrades.find(
      (item) => item.from.toLowerCase() === label.toLowerCase()
    );
    return match?.to || label;
  });
  const kept: string[] = [];
  for (const candidate of additions) {
    const duplicate = [...upgraded, ...kept].some(
      (existing) =>
        existing.toLowerCase() === candidate.toLowerCase() ||
        isNearDuplicate(candidate, existing)
    );
    if (!duplicate) kept.push(candidate);
  }
  return [...upgraded, ...kept].slice(0, 12);
}

function mergeLegacy(current: string[], generated: string[]): string[] {
  const result = [...current];
  for (const candidate of generated) {
    if (
      !result.some(
        (existing) =>
          existing.toLowerCase() === candidate.toLowerCase() ||
          isNearDuplicate(candidate, existing)
      )
    ) {
      result.push(candidate);
    }
  }
  return result.slice(0, 12);
}

export function mergeFocusBuild(input: {
  mode: FocusBuildMode;
  replaceFocus?: boolean;
  existingFocus?: unknown;
  selectedFocus?: unknown;
  result: FocusBuildResult;
}) {
  const existing = cleanFocusList(input.existingFocus);
  const selected = cleanFocusList(input.selectedFocus);
  const generated = cleanFocusList(input.result.focusAreas);

  if (input.mode === "refocus" && input.replaceFocus) {
    return {
      suggestedFocus: generated,
      selectedFocus: generated,
      added: generated.length,
      upgraded: 0,
    };
  }

  if (input.mode === "refocus") {
    const additions = cleanFocusList(input.result.additions, 6);
    const upgrades = cleanUpgrades(input.result.upgrades);
    const reconcile = input.result.reconcile === true;
    const suggestedFocus = reconcile
      ? mergeReconciled(existing, additions, upgrades)
      : mergeLegacy(existing, generated);
    const selectedFocus = reconcile
      ? mergeReconciled(selected, additions, upgrades)
      : mergeLegacy(selected, generated);
    return {
      suggestedFocus,
      selectedFocus,
      added: Math.max(0, suggestedFocus.length - existing.length),
      upgraded: reconcile
        ? upgrades.filter((upgrade) =>
            existing.some(
              (label) => label.toLowerCase() === upgrade.from.toLowerCase()
            )
          ).length
        : 0,
    };
  }

  const suggestedFocus = existing.length ? existing : generated;
  // A first build belongs to the newly generated focus. Do not let a stale
  // selection left in an old browser state become active on a different call.
  const selectedFocus = existing.length ? selected : generated;
  return { suggestedFocus, selectedFocus, added: 0, upgraded: 0 };
}
