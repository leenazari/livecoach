export const KNOWLEDGE_SECTIONS = [
  { key: "summary", title: "Business summary" },
  { key: "products", title: "Products and services" },
  { key: "pricing", title: "Pricing" },
  { key: "faqs", title: "FAQs and objections" },
  { key: "next", title: "Next step and booking" },
] as const;

export type KnowledgeSectionKey = (typeof KNOWLEDGE_SECTIONS)[number]["key"];

export const SOURCE_WEBSITE_TITLE = "Source website";
export const KNOWLEDGE_CHAR_CAP = 12000;

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

export function knowledgeFromDocuments(documents: Array<{ title: string; body: string }>): Record<KnowledgeSectionKey, string> {
  const next = emptyKnowledge();
  for (const document of documents) {
    const key = sectionKeyForTitle(document.title);
    if (!key || next[key]) continue;
    next[key] = document.body;
  }
  return next;
}
