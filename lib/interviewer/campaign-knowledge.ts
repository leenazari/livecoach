import { KNOWLEDGE_SECTIONS, OWNER_NOTES_TITLE, sectionKeyForTitle, type KnowledgeSectionKey } from "./knowledge";
import { QUALIFYING_TITLE } from "./qualifying";
import { parseObjections, parsePrice, parseProduct, questionLines } from "./setup-fields";
import { extractSetup } from "./setup-extract";
import { isInternalCostLine } from "./slide-notes";

const CAP = 1800;

export type CampaignKnowledgeInput = {
  campaignName?: string | null;
  opener?: string | null;
  quotesAllowed?: boolean;
  documents: Array<{ title: string; body: string }>;
  slides?: Array<{ number: number; title: string; oneLine?: string | null; talkingPoints?: string | null }>;
  deckKnowledge?: string | null;
  qualifyingQuestions?: string[];
};

export type KnowledgePart = { title: string; body: string; step: number; anchor: string };

export function campaignKnowledgeParts(input: CampaignKnowledgeInput): KnowledgePart[] {
  const docs = new Map<KnowledgeSectionKey, string>();
  const extras: string[] = [];
  let ownerNotes = "";
  for (const document of input.documents || []) {
    const title = String(document.title || "").trim();
    const key = title.toLowerCase();
    if (!title || key === "public calls" || key === "source website" || key === "call knowledge") continue;
    if (key === OWNER_NOTES_TITLE.toLowerCase()) {
      ownerNotes = String(document.body || "");
      continue;
    }
    const section = sectionKeyForTitle(title);
    if (section && !docs.has(section)) {
      docs.set(section, String(document.body || ""));
      continue;
    }
    if (key === QUALIFYING_TITLE.toLowerCase()) continue;
    const extraBody = clean(String(document.body || ""));
    if (extraBody) extras.push(`${title}\n${extraBody}`);
  }
  const product = parseProduct(docs.get("products") || "");
  const price = parsePrice(docs.get("pricing") || "");
  const prosePlans = price.plans.length ? price.plans : extractSetup(docs.get("pricing") || "").plans;
  const questions = (input.qualifyingQuestions?.length ? input.qualifyingQuestions : questionLines(bodyFor(input.documents, QUALIFYING_TITLE))).map(clean).filter(Boolean);
  const pairs = parseObjections(docs.get("objections") || "").filter((pair) => clean(pair.hear) || clean(pair.say));
  const seen = new Set<string>();
  const blocks = [
    part("Key message", lines([clean(docs.get("summary") || "")], seen), 1, "field-summary"),
    part("Opening line, already spoken", lines([clean(input.opener || "")], seen), 1, "field-opener"),
    part("Product", lines([product.summary && product.summary !== (docs.get("summary") || "") ? product.summary : ""], seen), 2, "field-product"),
    part("Ideal customer", lines([product.customer], seen), 2, "field-customer"),
    part("Benefits", bullets(product.benefits, seen), 2, "field-benefits"),
    part("Disqualifiers", bullets(product.disqualify, seen), 2, "field-disqualify"),
    part("Qualifying questions", bullets(questions, seen), 2, "field-questions"),
    part("Pricing", pricingBlock(input.quotesAllowed === true, price.note, prosePlans, price.trial, price.discount, price.avoid, seen), 3, "field-plans"),
    part("Objections", pairs.map((pair) => {
      const hear = clean(pair.hear).replace(/[.]+$/, "");
      const say = clean(pair.say).replace(/[.]+$/, "");
      return keep(clean(`When they say ${hear}. Say ${say}.`), seen);
    }).filter(Boolean).join("\n"), 4, "field-objections"),
    part("FAQs", lines([docs.get("faqs") || ""], seen), 4, "field-faqs"),
    part("Slides", slideLines(input.slides || [], seen), 1, "field-slides"),
    part("Next step", lines([docs.get("next") || ""], seen), 5, "field-next"),
    part("Owner notes", lines([ownerNotes], seen), 5, "field-owner-notes"),
    part("Also on file", lines(extras, seen), 5, "field-owner-notes"),
    part("Brochure notes", input.slides?.length ? "" : lines([input.deckKnowledge || ""], seen), 1, "field-slides"),
  ].filter((item): item is KnowledgePart => Boolean(item));
  return blocks;
}

export function compileCampaignKnowledge(input: CampaignKnowledgeInput): string {
  const blocks = campaignKnowledgeParts(input).map((item) => `${item.title}\n${item.body}`);
  let text = "What this campaign knows\n";
  for (const block of blocks) {
    if (text.length >= CAP) break;
    text += text.length + block.length + 2 > CAP ? `${block.slice(0, Math.max(0, CAP - text.length))}\n` : `\n${block}\n`;
  }
  const compiled = text.trim();
  return compiled.length > 40 ? compiled : "What this campaign knows\nNo campaign knowledge has been saved yet.";
}

function pricingBlock(quotesOn: boolean, note: string, plans: Array<{ name: string; price: string; period: string; includes: string; overage: string; details?: string }>, trial: string, discount: string, avoid: string, seen: Set<string>): string {
  const planLines = plans.filter((plan) => plan.price.trim() && !isInternalCostLine(`${plan.name} ${plan.price} ${plan.includes} ${plan.overage} ${plan.details || ""}`)).map((plan) => {
    const line = `${plan.name || "Plan"} is ${plan.price}${plan.period ? `, billed ${plan.period}` : ""}${plan.includes ? `, including ${plan.includes}` : ""}${plan.overage ? `, then ${plan.overage}` : ""}${plan.details ? `, ${plan.details}` : ""}.`;
    return keep(line, seen);
  }).filter(Boolean);
  const intro = quotesOn
    ? "Quotes are allowed. Say only these prices. Each line is one price point. Do not invent another tier."
    : "Prices are on file. Do not say a price on this call. Offer to cover price with a person later.";
  const parts = [
    intro,
    lines([note], seen),
    planLines.join("\n"),
    lines([trial ? `Trial: ${trial}` : "", discount ? `Discount: ${discount}` : "", avoid ? `Do not say: ${avoid}` : ""], seen),
  ].filter(Boolean);
  return parts.join("\n");
}

function part(title: string, body: string, step: number, anchor: string): KnowledgePart | null {
  const text = body.trim();
  return text ? { title, body: text, step, anchor } : null;
}

function slideLines(slides: CampaignKnowledgeInput["slides"], seen: Set<string>): string {
  return (slides || []).map((slide) => {
    const title = clean(slide.title) || "No headline yet";
    const when = clean(slide.oneLine || "");
    const points = clip(clean(slide.talkingPoints || ""), 90);
    return keep(`${slide.number}. ${title}.${points ? ` Talking points: ${points}` : ""}`, seen);
  }).filter(Boolean).join("\n");
}

function lines(values: string[], seen: Set<string>): string {
  return values.map((value) => clean(value)).filter(Boolean).map((line) => keep(line, seen)).filter(Boolean).join("\n");
}

function bullets(values: string[], seen: Set<string>): string {
  return values.map((value) => clean(value)).filter(Boolean).map((line) => keep(line, seen)).filter(Boolean).map((line) => `- ${line}`).join("\n");
}

function keep(value: string, seen: Set<string>): string {
  const key = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!key || seen.has(key)) return "";
  seen.add(key);
  return value;
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}.`;
}

function clean(value: string): string {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && !isInternalCostLine(line))
    .join("\n");
}

function bodyFor(documents: Array<{ title: string; body: string }>, title: string): string {
  return documents.find((document) => document.title.trim().toLowerCase() === title.toLowerCase())?.body || "";
}

export const KNOWLEDGE_SECTION_TITLES = KNOWLEDGE_SECTIONS.map((section) => section.title);
