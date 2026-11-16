export type ProductFields = {
  summary: string;
  customer: string;
  benefits: string[];
  disqualify: string[];
};

export type PricePlan = {
  name: string;
  price: string;
  period: string;
  includes: string;
  overage: string;
};

export type PriceFields = {
  note: string;
  plans: PricePlan[];
  trial: string;
  discount: string;
  avoid: string;
};

export type ObjectionPair = { hear: string; say: string };

export const STARTER_OBJECTIONS: ObjectionPair[] = [
  { hear: "It costs too much", say: "Use only a price written on this page. Then say setup is quick and the team handles it." },
  { hear: "Not the right time", say: "Ask when they want to move. Offer a short demo for that date." },
  { hear: "We already have something", say: "Ask what they use today. Show the difference on the matching slide." },
  { hear: "I need to ask my boss", say: "Offer a time the decision maker can join. Do not push a booking on this call." },
];

const PRODUCT_MARK = "\nIdeal customer\n";

export function parseProduct(body: string): ProductFields {
  const text = String(body || "").replace(/\r\n/g, "\n").trim();
  if (!text.includes(PRODUCT_MARK) && !text.startsWith("Product\n")) {
    return { summary: text, customer: "", benefits: [], disqualify: [] };
  }
  const sections = splitHeads(text, ["Product", "Ideal customer", "Benefits", "Disqualifiers"]);
  return {
    summary: sections.Product || "",
    customer: sections["Ideal customer"] || "",
    benefits: bullets(sections.Benefits || ""),
    disqualify: bullets(sections.Disqualifiers || ""),
  };
}

export function formatProduct(fields: ProductFields): string {
  return [
    "Product",
    fields.summary.trim(),
    "",
    "Ideal customer",
    fields.customer.trim(),
    "",
    "Benefits",
    asBullets(fields.benefits),
    "",
    "Disqualifiers",
    asBullets(fields.disqualify),
  ].join("\n").trim();
}

export function parsePrice(body: string): PriceFields {
  const text = String(body || "").replace(/\r\n/g, "\n").trim();
  if (!text.includes("\nPlans\n") && !text.startsWith("Pricing note\n")) {
    return { note: text, plans: [], trial: "", discount: "", avoid: "" };
  }
  const sections = splitHeads(text, ["Pricing note", "Plans", "Trial", "Discount", "Do not say"]);
  return {
    note: sections["Pricing note"] || "",
    plans: (sections.Plans || "").split("\n").map(planLine).filter((plan) => plan.name || plan.price || plan.includes),
    trial: sections.Trial || "",
    discount: sections.Discount || "",
    avoid: sections["Do not say"] || "",
  };
}

export function formatPrice(fields: PriceFields): string {
  const plans = fields.plans
    .filter((plan) => plan.name.trim() || plan.price.trim() || plan.includes.trim())
    .map((plan) => `- ${plan.name.trim()} | ${plan.price.trim()} | ${plan.period.trim()} | ${plan.includes.trim()} | ${plan.overage.trim()}`);
  return [
    "Pricing note",
    fields.note.trim(),
    "",
    "Plans",
    plans.join("\n"),
    "",
    "Trial",
    fields.trial.trim(),
    "",
    "Discount",
    fields.discount.trim(),
    "",
    "Do not say",
    fields.avoid.trim(),
  ].join("\n").trim();
}

export function parseObjections(body: string): ObjectionPair[] {
  const text = String(body || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (!/When they say:/i.test(text)) return [{ hear: "", say: text }];
  return text.split(/\n(?=When they say:)/i).map((block) => {
    const hear = block.match(/When they say:\s*([\s\S]*?)(?:\nSay:|$)/i)?.[1]?.trim() || "";
    const say = block.match(/\nSay:\s*([\s\S]*)$/i)?.[1]?.trim() || "";
    return { hear, say };
  }).filter((pair) => pair.hear || pair.say);
}

export function formatObjections(pairs: ObjectionPair[]): string {
  return pairs
    .filter((pair) => pair.hear.trim() || pair.say.trim())
    .map((pair) => `When they say: ${pair.hear.trim()}\nSay: ${pair.say.trim()}`)
    .join("\n\n");
}

export function questionLines(body: string): string[] {
  return String(body || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter((line) => line.length > 2);
}

export function formatQuestions(lines: string[]): string {
  return lines.map((line) => line.trim()).filter((line) => line.length > 2).join("\n");
}

export function priceSpeech(quotesOn: boolean, fields: PriceFields): string {
  if (!quotesOn) return "The agent will not quote a price. It offers to cover price with a person later.";
  const lines = fields.plans.filter((plan) => plan.price.trim()).map((plan) => `${plan.name || "Plan"} is ${plan.price}${plan.period ? `, billed ${plan.period}` : ""}${plan.includes ? `, including ${plan.includes}` : ""}${plan.overage ? `, then ${plan.overage}` : ""}`);
  if (!lines.length && !fields.note.trim()) return "Quotes are on, but no price is written yet. The agent must not invent one.";
  if (!lines.length) return "The agent may say only a price written in the note. It must not invent another tier.";
  return `The agent may quote each plan on its own: ${lines.join(". ")}. It must not merge two tiers into one price.`;
}

function splitHeads(text: string, heads: string[]): Record<string, string> {
  const pattern = new RegExp(`^(${heads.map(escapeReg).join("|")})(?:\\n|$)`, "m");
  const chunks = text.split(pattern).slice(1);
  const out: Record<string, string> = {};
  for (let i = 0; i < chunks.length; i += 2) out[chunks[i]] = (chunks[i + 1] || "").trim();
  return out;
}

function bullets(text: string): string[] {
  return text.split("\n").map((line) => line.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
}

function asBullets(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).map((line) => `- ${line}`).join("\n");
}

function planLine(line: string): PricePlan {
  const clean = line.replace(/^\s*[-*•]\s*/, "").trim();
  const parts = clean.split("|").map((part) => part.trim());
  if (parts.length >= 5) {
    return { name: parts[0], price: parts[1], period: parts[2], includes: parts[3], overage: parts[4] };
  }
  return { name: parts[0] || "", price: parts[1] || "", period: "", includes: parts[2] || "", overage: "" };
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
