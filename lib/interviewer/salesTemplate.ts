import { guardrailRules } from "./guardrails";
import { KNOWLEDGE_SECTIONS, type KnowledgeSectionKey } from "./knowledge";
import { pronunciationRules } from "./pronunciations";
import { walkOrderNote } from "./slide-role";

export const DECK_IMPORT_SOURCE = "deck-import";

export const GENERIC_QUALIFYING_QUESTIONS = [
  "What does the business do?",
  "How big is the team?",
  "What are you using today?",
  "What is the main challenge with that?",
  "When are you looking to move on this?",
  "Who decides?",
];

const STOP = new Set([
  "your", "with", "the", "and", "for", "every", "from", "this", "that", "into",
  "they", "them", "about", "their", "have", "will", "when", "what", "where",
  "which", "show", "slide", "only", "best", "more", "always", "after", "before",
]);

const PRICE = /(?:£|\$|€)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:pounds?|dollars?|euros?)\b/gi;

export type DeckFact = {
  number: number;
  title: string;
  oneLine?: string | null;
  talkingPoints?: string | null;
  verbatim?: string | null;
};

export function websiteInBrochure(text: string): string | null {
  const explicit = text.match(/https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/[^\s)]*)?/i);
  const bare = text.match(/\b(?:www\.)?([a-z0-9-]+\.(?:co\.uk|com|uk|io|ai|net|org))\b/i);
  const host = (explicit?.[1] || bare?.[1] || "").replace(/^www\./, "").toLowerCase();
  if (!host || /supabase|vercel|localhost/.test(host)) return null;
  return `https://${host}`;
}

export function productLabel(campaignName: string): string {
  const name = String(campaignName || "").replace(/\s+/g, " ").trim();
  const beforeTest = name.split(/\btest\b/i)[0].replace(/[:\-–].*$/, "").trim();
  return beforeTest || name;
}

export function defaultOpener(campaignName: string): string {
  const product = productLabel(campaignName);
  const brochure = product ? `the ${product} brochure` : "the brochure";
  return `Thanks for joining the call. I'm going to walk you through ${brochure} today, but before we get started, tell me a little bit about your business.`;
}

export function salesRules(qualifying: string[]): string {
  const questions = (qualifying.length ? qualifying : GENERIC_QUALIFYING_QUESTIONS).slice(0, 12).join(" ");
  return `Do light discovery before you pitch. After the opening, ask about how they work today, one question at a time, in your own words. Acknowledge each answer in a few plain words, then ask the next. Do not ask two in a row, and do not pitch a product before you understand their setup. Questions to cover: ${questions}
Once you know how they work, suggest one improvement that fits what they said and is written in the notes or the deck. Explain the benefit for their setup in one or two plain sentences, then call show_slide for that topic. Do not suggest a feature they gave you no reason to mention, and do not invent a price.
Keep an interest list in the order they name things. Cover every item on that list before you introduce anything they did not ask for. When you finish one, bridge to the next in one plain line, such as "You also mentioned that, let me show you that." Add a new topic only after that list is done, or when they ask. If a private note says something is still to cover, do that next and do not read the note aloud. Never quote a line marked Unconfirmed.
Treat them as a warm inbound lead, one step past cold. They clicked a link, visited the site, or read an email, so they have some idea, but do not assume they know the product. Cover the core basics in one quick line that frames what it does for their business. That is not a cold "what is this thing" explanation. Then move quickly into features. Never go backwards into a long intro after discovery, and skip intro and "what is it" slides unless they seem unsure.
Acknowledge what they just said in one short line, then move straight to the most relevant feature. Do not reset into a fresh introduction after fact-finding.
After the opener and one or two discovery answers, start walking the deck. If you still do not know the business, ask one short question before the first feature slide. Aim for a new slide about every 30 to 45 seconds. One or two punchy sentences per slide, tied to what they said, then call show_slide for the next feature. Prefer a feature slide that matches what they named, then continue through the remaining feature slides. Skip setup, onboarding, installation and how-to-get-started slides unless they ask. Near the close, one line is enough: setup is quick, the team handles it.
Be upbeat, energetic and conversational. Short sentences. Sound interested. Name a concrete win for their business.
After that first feature, regularly offer a choice of two things to see next, based on the remaining relevant slides. One sentence, such as "Would you rather see how appointments get booked, or how the brochure is used?" Then call show_slide for the one they choose. Do not offer a setup or intro slide in that choice unless they asked.
Never describe a feature without a concrete scenario from their business. Use the private lead business profile. If a field is unknown, do not invent it.
When they push back, use the Objection handling note if one is saved. Say that short reply, then ask the question at the end. An owner note wins over a brochure note with the same title. A brochure line that says no price is printed does not cancel a price in the owner Pricing note.
${pronunciationRules()}
${guardrailRules()}`;
}

export function pricesInDeck(slides: DeckFact[]): string[] {
  const found = new Set<string>();
  for (const slide of slides) {
    const bag = `${slide.title} ${slide.oneLine || ""} ${slide.talkingPoints || ""} ${slide.verbatim || ""}`;
    for (const match of bag.match(PRICE) || []) found.add(match.replace(/\s+/g, " ").trim());
  }
  return [...found];
}

function sentences(slide: DeckFact): string[] {
  const points = String(slide.talkingPoints || "").split(/\n+/).map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
  const head = slide.title.replace(/\s+/g, " ").trim();
  return [head, ...points].filter(Boolean).map((line) => /[.!?]$/.test(line) ? line : `${line}.`);
}

export function notesFromDeck(slides: DeckFact[]): Record<KnowledgeSectionKey, string> {
  const ordered = [...slides].sort((left, right) => left.number - right.number);
  const summarySlides = ordered.slice(0, 2);
  const summary = summarySlides.flatMap(sentences).join(" ") || "The brochure does not include a summary. Do not invent one.";
  const products = ordered.flatMap((slide) => sentences(slide).slice(0, 2)).join(" ") || "The brochure does not list products. Do not invent any.";
  const prices = pricesInDeck(ordered);
  const pricing = prices.length
    ? `Prices stated in the brochure: ${prices.join("; ")}.`
    : "No price is printed in the brochure.";
  const asked = ordered.flatMap(sentences).filter((line) => line.includes("?"));
  const faqs = asked.length
    ? asked.join(" ")
    : "The brochure does not list frequently asked questions or objections.";
  const nextSlides = ordered.filter((slide) => /\b(demo|book)\b/i.test(`${slide.title} ${slide.oneLine || ""}`));
  const next = nextSlides.length
    ? nextSlides.flatMap(sentences).join(" ")
    : "The brochure asks for a conversation with the team when the person is interested.";
  return { summary, products, pricing, faqs, objections: "", next };
}

export function deckNoteRows(slides: DeckFact[]): Array<{ title: string; body: string }> {
  const notes = notesFromDeck(slides);
  return KNOWLEDGE_SECTIONS.flatMap((section) => {
    const body = notes[section.key].trim();
    return body ? [{ title: section.title, body }] : [];
  });
}

export function deckWalkNote(slides: DeckFact[]): string {
  return walkOrderNote(slides.map((slide) => ({ number: slide.number, title: slide.title })));
}
}

export function qualifyingFromDeck(slides: DeckFact[]): string[] {
  const bag = slides.map((slide) => `${slide.title} ${slide.talkingPoints || ""}`).join(" ").toLowerCase();
  const extra: string[] = [];
  if (/website|visitor|widget/.test(bag)) extra.push("What happens today when someone visits the website and nobody is free?");
  if (/brochure|knowledge|train/.test(bag)) extra.push("What should the agent know before it speaks to a visitor?");
  if (/demo|book/.test(bag)) extra.push("Who would want to see a demo?");
  return [...GENERIC_QUALIFYING_QUESTIONS, ...extra].slice(0, 8);
}
