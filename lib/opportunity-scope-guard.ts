export type OpportunityProposal = {
  title: string;
  detail?: string | null;
  sessionId?: string | null;
};

const PROPOSAL_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "client",
  "company",
  "customer",
  "deal",
  "for",
  "from",
  "in",
  "interviewa",
  "of",
  "opportunity",
  "our",
  "pilot",
  "project",
  "service",
  "software",
  "solution",
  "the",
  "their",
  "to",
  "with",
]);

const proposalTokens = (...values: unknown[]) =>
  new Set(
    values
      .map((value) => String(value || "").toLowerCase())
      .join(" ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((word) => word.length >= 3 && !PROPOSAL_STOP_WORDS.has(word))
  );

const normalTitle = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A second AI suggestion may reuse the canonical deal only when the saved and
// proposed evidence are clearly about the same buying decision. Anything less
// certain must be confirmed by a human.
export function opportunityProposalNeedsConfirmation(
  existing: Record<string, any>,
  draft: OpportunityProposal
): boolean {
  if (
    draft.sessionId &&
    existing.session_id &&
    String(draft.sessionId) === String(existing.session_id)
  ) {
    return false;
  }

  const existingTitle = normalTitle(existing.title);
  const proposedTitle = normalTitle(draft.title);
  if (
    existingTitle &&
    proposedTitle &&
    (existingTitle === proposedTitle ||
      (Math.min(existingTitle.length, proposedTitle.length) >= 12 &&
        (existingTitle.includes(proposedTitle) ||
          proposedTitle.includes(existingTitle))))
  ) {
    return false;
  }

  const saved = proposalTokens(existing.title, existing.detail);
  const proposed = proposalTokens(draft.title, draft.detail);
  if (!saved.size || !proposed.size) return true;
  let shared = 0;
  for (const token of proposed) if (saved.has(token)) shared += 1;
  const coverage = shared / Math.min(saved.size, proposed.size);
  return !(shared >= 2 && coverage >= 0.6);
}
