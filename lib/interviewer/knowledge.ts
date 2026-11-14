export const KNOWLEDGE_SECTIONS = [
  { key: "summary", title: "Business summary" },
  { key: "products", title: "Products and services" },
  { key: "pricing", title: "Pricing" },
  { key: "faqs", title: "FAQs and objections" },
  { key: "next", title: "Next step and booking" },
] as const;

export type KnowledgeSectionKey = (typeof KNOWLEDGE_SECTIONS)[number]["key"];

export const SOURCE_WEBSITE_TITLE = "Source website";

export function emptyKnowledge(): Record<KnowledgeSectionKey, string> {
  return { summary: "", products: "", pricing: "", faqs: "", next: "" };
}

export function sectionKeyForTitle(title: string): KnowledgeSectionKey | null {
  const found = KNOWLEDGE_SECTIONS.find((section) => section.title.toLowerCase() === title.trim().toLowerCase());
  return found ? found.key : null;
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
