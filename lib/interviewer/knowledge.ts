export const KNOWLEDGE_SECTIONS = [
  { key: "summary", title: "Business summary" },
  { key: "products", title: "Products and services" },
  { key: "pricing", title: "Pricing" },
  { key: "faqs", title: "FAQs and objections" },
  { key: "next", title: "Next step and booking" },
] as const;

export type KnowledgeSectionKey = (typeof KNOWLEDGE_SECTIONS)[number]["key"];

export const SOURCE_WEBSITE_TITLE = "Source website";
export const WEBSITE_IMPORT_SOURCE = "website-import";
export const KNOWLEDGE_CHAR_CAP = 12000;

export function isMissingSourceColumn(error: { message?: string; code?: string } | null): boolean {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("source") && (text.includes("does not exist") || text.includes("42703") || text.includes("schema cache"));
}

export function websiteImportIds(rows: Array<{ id: string; source?: string | null }>): string[] {
  return rows.filter((row) => row.source === WEBSITE_IMPORT_SOURCE).map((row) => row.id);
}

export function knowledgeLength(sections: Record<KnowledgeSectionKey, string>): number {
  return KNOWLEDGE_SECTIONS.reduce((sum, section) => sum + sections[section.key].trim().length, 0);
}

export function emptyKnowledge(): Record<KnowledgeSectionKey, string> {
  return { summary: "", products: "", pricing: "", faqs: "", next: "" };
}

export function sectionKeyForTitle(title: string): KnowledgeSectionKey | null {
  const normalised = title.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!normalised || normalised === "source website") return null;
  const exact = KNOWLEDGE_SECTIONS.find((section) => section.title.toLowerCase() === normalised);
  if (exact) return exact.key;
  if (/(faq|objection)/.test(normalised)) return "faqs";
  if (/\bpric/.test(normalised)) return "pricing";
  if (/(product|service)/.test(normalised)) return "products";
  if (/(book|next step)/.test(normalised)) return "next";
  if (/(summary|about|overview|who it)/.test(normalised)) return "summary";
  return null;
}

export function knowledgeFromDocuments(documents: Array<{ title: string; body: string; source?: string | null }>): Record<KnowledgeSectionKey, string> {
  const next = emptyKnowledge();
  const rank = new Map<KnowledgeSectionKey, number>();
  for (const document of documents) {
    const key = sectionKeyForTitle(document.title);
    if (!key) continue;
    const weight = document.source === WEBSITE_IMPORT_SOURCE ? 0 : 1;
    const current = rank.get(key);
    if (current === undefined) {
      next[key] = document.body;
      rank.set(key, weight);
      continue;
    }
    if (weight > current) {
      next[key] = document.body;
      rank.set(key, weight);
    }
  }
  return next;
}

export function preferKnowledgeNotes<T extends { title: string; body: string; source?: string | null }>(rows: T[]): T[] {
  const chosen = new Map<string, T>();
  for (const row of rows) {
    const key = row.title.trim().toLowerCase();
    if (!key || key === SOURCE_WEBSITE_TITLE.toLowerCase()) continue;
    const current = chosen.get(key);
    if (!current) {
      chosen.set(key, row);
      continue;
    }
    if (current.source === WEBSITE_IMPORT_SOURCE && row.source !== WEBSITE_IMPORT_SOURCE) chosen.set(key, row);
  }
  return [...chosen.values()];
}
