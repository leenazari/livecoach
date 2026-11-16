import { KNOWLEDGE_SECTIONS, sectionKeyForTitle, type KnowledgeSectionKey } from "./knowledge";
import { QUALIFYING_TITLE } from "./qualifying";
import { parseObjections, parsePrice, parseProduct, questionLines } from "./setup-fields";
import { extractSetup } from "./setup-extract";
import { isInternalCostLine } from "./slide-notes";

const CAP = 9000;

export type CampaignKnowledgeInput = {
  campaignName?: string | null;
  opener?: string | null;
  quotesAllowed?: boolean;
  documents: Array<{ title: string; body: string }>;
  slides?: Array<{ number: number; title: string; oneLine?: string | null; talkingPoints?: string | null }>;
  deckKnowledge?: string | null;
  qualifyingQuestions?: string[];
};

export function compileCampaignKnowledge(input: CampaignKnowledgeInput): string {
  const docs = new Map<KnowledgeSectionKey, string>();
  const extras: string[] = [];
  for (const document of input.documents || []) {
    const title = String(document.title || "").trim();
    const key = title.toLowerCase();
    if (!title || key === "public calls" || key === "source website" || key === "call knowledge") continue;
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
    section("Key message", lines([clean(docs.get("summary") || "")], seen)),
    section("Opening line, already spoken", lines([clean(input.opener || "")], seen)),
    section("Product", lines([product.summary && product.summary !== (docs.get("summary") || "") ? product.summary : ""], seen)),
    section("Ideal customer", lines([product.customer], seen)),
    section("Benefits", bullets(product.benefits, seen)),
    section("Disqualifiers", bullets(product.disqualify, seen)),
    section("Qualifying questions", bullets(questions, seen)),
    pricingBlock(input.quotesAllowed === true, price.note, prosePlans, price.trial, price.discount, price.avoid, seen),
    section("Objections", pairs.map((pair) => {
      const hear = clean(pair.hear).replace(/[.]+$/, "");
      const say = clean(pair.say).replace(/[.]+$/, "");
      return keep(clean(`When they say ${hear}. Say ${say}.`), seen);
    }).filter(Boolean).join("\n")),
    section("FAQs", lines([docs.get("faqs") || ""], seen)),
    section("Slides", slideLines(input.slides || [], seen)),
    section("Next step", lines([docs.get("next") || ""], seen)),
    section("Also on file", lines(extras, seen)),
    section("Brochure notes", lines([input.deckKnowledge || ""], seen)),
  ].filter(Boolean);
  let text = "What this campaign knows\n";
  for (const block of blocks) {
    if (text.length >= CAP) break;
    text += text.length + block.length + 2 > CAP ? `${block.slice(0, Math.max(0, CAP - text.length))}\n` : `\n${block}\n`;
  }
  const compiled = text.trim();
  return compiled.length > 40 ? compiled : "What this campaign knows\nNo campaign knowledge has been saved yet.";
}

function pricingBlock(quotesOn: boolean, note: string, plans: Array<{ name: string; price: string; period: string; includes: string; overage: string }>, trial: string, discount: string, avoid: string, seen: Set<string>): string {
  const planLines = plans.filter((plan) => plan.price.trim() && !isInternalCostLine(`${plan.name} ${plan.price} ${plan.includes} ${plan.overage}`)).map((plan) => {
    const line = `${plan.name || "Plan"} is ${plan.price}${plan.period ? `, billed ${plan.period}` : ""}${plan.includes ? `, including ${plan.includes}` : ""}${plan.overage ? `, then ${plan.overage}` : ""}.`;
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
  return section("Pricing", parts.join("\n"));
}

function slideLines(slides: CampaignKnowledgeInput["slides"], seen: Set<string>): string {
  return (slides || []).map((slide) => {
    const title = clean(slide.title) || "No headline yet";
    const when = clean(slide.oneLine || "");
    const points = clean(slide.talkingPoints || "");
    return keep(`${slide.number}. ${title}.${when ? ` Show when ${when}.` : ""}${points ? ` Talking points: ${points}.` : ""}`, seen);
  }).filter(Boolean).join("\n");
}

function section(title: string, body: string): string {
  const text = body.trim();
  return text ? `${title}\n${text}` : "";
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
