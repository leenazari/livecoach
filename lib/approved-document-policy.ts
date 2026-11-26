export const APPROVED_DOCUMENTS = {
  adam_brochure: "Adam sales-agent brochure",
  training_guide: "Candidate training guide",
  hiring_brochure: "Hiring brochure",
  education_brochure: "Education brochure",
  overview_brochure: "Interviewa overview brochure",
  price_list: "Standard price list",
} as const;
export type ApprovedDocumentKey = keyof typeof APPROVED_DOCUMENTS;
export type ApprovedDocument = {
  key: ApprovedDocumentKey; version: string; name: string; size: number;
  path: string; sha256: string; approvedAt: string;
};
export const DOCUMENT_CONFIG_PREFIX = "approved_document:";
export const AUTO_DRAFT_CONFIG = "call_deliverable_auto_drafts";
export const APPROVED_DOCUMENT_BUCKET = "crm-documents";
export const MAX_APPROVED_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const isApprovedDocumentKey = (key: unknown): key is ApprovedDocumentKey =>
  typeof key === "string" && Object.hasOwn(APPROVED_DOCUMENTS, key);

// Match the promise itself, never unrelated company history or a random file.
// Ambiguity is a visible blocker rather than permission to attach a guess.
export function requestedApprovedDocument(text: string): ApprovedDocumentKey | "ambiguous" | null {
  if (!/\b(brochure|guide|price list|pricing|prices|rate card|sales material|marketing resource)\b/i.test(text)) return null;
  const matches: ApprovedDocumentKey[] = [];
  if (/\b(adam|sales.agent|website.agent)\b/i.test(text)) matches.push("adam_brochure");
  if (/\b(candidate.training|interview.support|mock.interview|training.guide)\b/i.test(text)) matches.push("training_guide");
  if (/\b(hiring|recruitment)\b/i.test(text)) matches.push("hiring_brochure");
  if (/\b(education|admissions|educator)\b/i.test(text)) matches.push("education_brochure");
  if (/\b(overview|general|company)\s+brochure\b/i.test(text)) matches.push("overview_brochure");
  if (/\b(price list|pricing|prices|rate card)\b/i.test(text)) return matches.length ? "ambiguous" : "price_list";
  return matches.length === 1 ? matches[0] : "ambiguous";
}
