import {
  STARTER_OBJECTIONS,
  type ObjectionPair,
  type PricePlan,
  type ProductFields,
} from "./setup-fields";

export type ExtractSource = "website" | "brochure" | "price sheet";

export type SetupExtract = {
  summary: string;
  opener: string;
  customer: string;
  benefits: string[];
  disqualify: string[];
  questions: string[];
  note: string;
  plans: PricePlan[];
  trial: string;
  discount: string;
  objections: ObjectionPair[];
  slidePoints: Array<{ title: string; point: string }>;
};

export type Suggestion = {
  id: string;
  step: 1 | 2 | 3 | 4;
  label: string;
  preview: string;
  source: ExtractSource | "starter";
  apply: "summary" | "opener" | "product" | "customer" | "benefit" | "disqualify" | "question" | "note" | "plan" | "trial" | "discount" | "objection" | "slide";
  value: string;
  plan?: PricePlan;
  pair?: ObjectionPair;
  slideTitle?: string;
};

const PRICE = /(?:£|\$|€)\s?\d[\d,]*(?:\.\d{1,2})?/g;

export function cleanExtractText(value: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>`]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function emptyExtract(): SetupExtract {
  return {
    summary: "",
    opener: "",
    customer: "",
    benefits: [],
    disqualify: [],
    questions: [],
    note: "",
    plans: [],
    trial: "",
    discount: "",
    objections: [],
    slidePoints: [],
  };
}

export function extractSetup(raw: string, slides: Array<{ title: string }> = []): SetupExtract {
  const text = cleanExtractText(raw);
  const lines = String(raw || "")
    .replace(/<[^>]+>/g, "\n")
    .split(/\n+/)
    .map((line) => cleanExtractText(line))
    .filter((line) => line.length > 2 && !/no price is printed/i.test(line));
  const sentences = text.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter((line) => line.length > 12);
  const fromBullets = unique(String(raw || "").split(/\n+/).flatMap((row) => {
    const match = row.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    return match ? [cleanExtractText(match[1])] : [];
  })).filter((line) => line.length > 8 && line.length < 160 && !/(?:£|\$|€)\s?\d/.test(line)).slice(0, 8);
  const benefits = unique(sentences.filter((line) => looksLikeBenefit(line))).slice(0, 8);
  const customer = sentences.find((line) => /\b(suits?|ideal for|for teams|for businesses|who sell|any business that)\b/i.test(line)) || "";
  const disqualify = sentences.filter((line) => /\b(not for|does not suit|won't suit|only if they|do not use if)\b/i.test(line)).slice(0, 4);
  const questions = unique(sentences.filter((line) => /\?\s*$/.test(line) && line.length < 140)).slice(0, 8);
  const plans = plansFromText(text);
  const trial = text.match(/\b\d+\s*-?\s*day free trial\b/i)?.[0] || sentences.find((line) => /\btrial\b/i.test(line) && line.length < 80 && !/\bno trial\b/i.test(line)) || "";
  const discountMatch = text.match(/\b(?:save\s+\d+\s*%|\d+\s*%\s*off)/i);
  const discount = discountMatch ? capitalise(discountMatch[0]) : "";
  const objections = objectionsFrom(sentences);
  const summary = sentences.find((line) => line.length > 40 && line.length < 220 && !PRICE.test(reset(line))) || "";
  const slidePoints = slides.map((slide) => {
    const words = slide.title.toLowerCase().split(/\W+/).filter((word) => word.length > 4).slice(0, 3);
    const hit = sentences.find((line) => words.filter((word) => line.toLowerCase().includes(word)).length >= Math.min(2, words.length));
    return { title: slide.title, point: hit ? clip(hit, 160) : "" };
  }).filter((item) => item.point);
  return {
    summary: clip(summary, 220),
    opener: "",
    customer: clip(customer, 180),
    benefits: unique([...fromBullets, ...benefits]).slice(0, 8).map(capitalise),
    disqualify: disqualify.map((line) => clip(line, 140)),
    questions: questions.map((line) => clip(line, 120)),
    note: plans[0] ? `From ${plans[0].price}${plans[0].period ? ` ${plans[0].period}` : ""}.` : "",
    plans,
    trial: clip(trial, 160),
    discount: clip(discount, 160),
    objections,
    slidePoints,
  };
}

export function mergeExtracts(items: Array<{ source: ExtractSource; extract: SetupExtract }>): SetupExtract {
  const merged = emptyExtract();
  const seenPrices = new Set<string>();
  for (const item of items) {
    const next = item.extract;
    merged.summary ||= next.summary;
    merged.customer ||= next.customer;
    merged.trial ||= next.trial;
    merged.discount ||= next.discount;
    merged.note ||= next.note;
    merged.benefits = unique([...merged.benefits, ...next.benefits]);
    merged.disqualify = unique([...merged.disqualify, ...next.disqualify]);
    merged.questions = unique([...merged.questions, ...next.questions]);
    for (const plan of next.plans) {
      const key = `${plan.name.toLowerCase()}|${plan.price.toLowerCase()}|${plan.period.toLowerCase()}`;
      if (seenPrices.has(key)) continue;
      seenPrices.add(key);
      merged.plans.push(plan);
    }
    for (const pair of next.objections) {
      if (!merged.objections.some((item) => item.hear.toLowerCase() === pair.hear.toLowerCase())) merged.objections.push(pair);
    }
    for (const point of next.slidePoints) {
      if (!merged.slidePoints.some((item) => item.title === point.title)) merged.slidePoints.push(point);
    }
  }
  return merged;
}

export function suggestionsFor(input: {
  extract: SetupExtract;
  source: ExtractSource;
  summary: string;
  opener: string;
  productSummary: string;
  customer: string;
  benefits: string[];
  disqualify: string[];
  questions: string[];
  note: string;
  plans: PricePlan[];
  trial: string;
  discount: string;
  objections: ObjectionPair[];
  slides: Array<{ number: number; title: string; talkingPoints?: string }>;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (item: Suggestion) => out.push(item);
  if (!input.summary.trim() && input.extract.summary) add(field(1, "summary", "Key message", input.extract.summary, input.source));
  if (!input.opener.trim() && input.extract.summary) add(field(1, "opener", "Opener", `Thanks for joining. ${clip(input.extract.summary, 120)}`, input.source));
  for (const point of input.extract.slidePoints) {
    const slide = input.slides.find((item) => item.title === point.title);
    if (slide && !String(slide.talkingPoints || "").trim()) {
      add({ ...field(1, "slide", `Slide ${slide.number} talking point`, point.point, input.source), slideTitle: slide.title });
    }
  }
  if (!input.productSummary.trim() && input.extract.summary) add(field(2, "product", "Product summary", input.extract.summary, input.source));
  if (!input.customer.trim() && input.extract.customer) add(field(2, "customer", "Ideal customer", input.extract.customer, input.source));
  for (const benefit of input.extract.benefits) {
    if (!input.benefits.some((item) => same(item, benefit))) add(field(2, "benefit", "Benefit", benefit, input.source));
  }
  for (const line of input.extract.disqualify) {
    if (!input.disqualify.some((item) => same(item, line))) add(field(2, "disqualify", "Disqualifier", line, input.source));
  }
  for (const question of input.extract.questions) {
    if (!input.questions.some((item) => same(item, question))) add(field(2, "question", "Qualifying question", question, input.source));
  }
  if (!input.note.trim() && input.extract.note) add(field(3, "note", "Pricing note", input.extract.note, input.source));
  for (const plan of input.extract.plans) {
    if (input.plans.some((item) => same(item.price, plan.price) && same(item.period, plan.period) && same(item.name, plan.name))) continue;
    add({
      ...field(3, "plan", plan.name || "Plan", planPreview(plan), input.source),
      plan,
    });
  }
  if (!input.trial.trim() && input.extract.trial) add(field(3, "trial", "Trial", input.extract.trial, input.source));
  if (!input.discount.trim() && input.extract.discount) add(field(3, "discount", "Discount", input.extract.discount, input.source));
  for (const pair of [...input.extract.objections, ...STARTER_OBJECTIONS]) {
    if (input.objections.some((item) => same(item.hear, pair.hear))) continue;
    const source = STARTER_OBJECTIONS.some((item) => item.hear === pair.hear) && !input.extract.objections.some((item) => item.hear === pair.hear) ? "starter" : input.source;
    add({ ...field(4, "objection", "Objection", `${pair.hear} — ${pair.say}`, source), pair });
  }
  return out.map((item, index) => ({ ...item, id: `${item.step}-${item.apply}-${index}` }));
}

function field(step: Suggestion["step"], apply: Suggestion["apply"], label: string, preview: string, source: Suggestion["source"]): Suggestion {
  return { id: "", step, label, preview, source, apply, value: preview };
}

function plansFromText(text: string): PricePlan[] {
  const plans: PricePlan[] = [];
  const pattern = /(?:£|\$|€)\s?\d[\d,]*(?:\.\d{1,2})?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const price = match[0].replace(/\s+/g, " ");
    const window = text.slice(Math.max(0, match.index - 90), Math.min(text.length, match.index + price.length + 70));
    if (/no price|do not state a per-minute/i.test(window)) continue;
    if (/\boverage\b/i.test(text.slice(Math.max(0, match.index - 16), match.index))) {
      const last = plans[plans.length - 1];
      if (last) last.overage = `${price} per minute`;
      continue;
    }
    const before = text.slice(Math.max(0, match.index - 90), match.index);
    const nameMatch = before.match(/([A-Za-z][A-Za-z0-9]+)\s+(?:Yearly|Monthly|Annual)\s*$/i)
      || before.match(/([A-Z][A-Za-z0-9]+)\s*:\s*$/)
      || before.match(/([A-Z][A-Za-z0-9]+)\s*$/);
    const named = nameMatch && !/^(From|Only|The|And|For|Yearly|Monthly|Annual)$/i.test(nameMatch[1]) ? capitalise(nameMatch[1]) : "";
    const period = periodNear(text, match.index, price);
    plans.push({
      name: named || (period === "yearly" ? "Annual" : period === "monthly" ? "Monthly" : "Plan"),
      price,
      period,
      includes: includesNear(text, match.index, price),
      overage: overageNear(text.slice(match.index, match.index + price.length + 36)),
    });
  }
  const bare = /([A-Z][A-Za-z0-9]+)\s+(Free|Custom)\b(?!\s+(?:features|forever|plan|trial))/g;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = bare.exec(text))) {
    const name = capitalise(bareMatch[1]);
    if (/^(The|And|For|From|Only|Try|Use|Get|Start|Save)$/i.test(name)) continue;
    plans.push({ name, price: capitalise(bareMatch[2].toLowerCase()), period: "", includes: "", overage: "" });
  }
  const uniquePlans: PricePlan[] = [];
  for (const plan of plans) {
      const generic = /^(monthly|yearly|annual|plan)$/i;
      const clash = uniquePlans.find((item) => same(item.price, plan.price) && same(item.period, plan.period) && (same(item.name, plan.name) || generic.test(plan.name) || generic.test(item.name)));
      if (clash) {
        if (generic.test(clash.name) && !generic.test(plan.name)) clash.name = plan.name;
        continue;
      }
    uniquePlans.push(plan);
  }
  return uniquePlans;
}

function periodNear(line: string, at: number, price: string): string {
  const before = line.slice(Math.max(0, at - 18), at).toLowerCase();
  const after = line.slice(at, at + price.length + 22).toLowerCase();
  if (/yearly|annual/.test(before)) return "yearly";
  if (/month|\/mo/.test(after)) return "monthly";
  if (/year|annual|annum|\/yr/.test(after)) return "yearly";
  if (/week/.test(after)) return "weekly";
  return "";
}

function includesNear(line: string, at: number, price: string): string {
  const after = line.slice(at + price.length, at + price.length + 80);
  const before = line.slice(Math.max(0, at - 40), at);
  const pick = (chunk: string) => {
    const minutes = chunk.match(/\b\d[\d,]*\s+minutes?\b/i);
    const users = chunk.match(/\b\d[\d,]*\s+users?\b/i);
    const perUser = /per user|\/\s*user/i.test(chunk) ? "per user" : "";
    return [minutes?.[0], users?.[0], perUser].filter(Boolean).join(", ");
  };
  return pick(after) || pick(before);
}

function overageNear(line: string): string {
  const match = line.match(/(?:overage|extra minutes?|thereafter)[^.]{0,40}/i);
  return match ? cleanExtractText(match[0]) : "";
}

function objectionsFrom(sentences: string[]): ObjectionPair[] {
  const pairs: ObjectionPair[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const quoted = sentences[i].match(/^[“"]([^”"]+)[”"]\.?$/);
    if (!quoted) continue;
    const say = sentences[i + 1] && !/^[“"]/.test(sentences[i + 1]) ? sentences[i + 1] : "";
    if (say) pairs.push({ hear: quoted[1], say: clip(say, 220) });
  }
  return pairs.slice(0, 6);
}

function looksLikeBenefit(line: string): boolean {
  return /\b(answers|books|greets|tracks|saves|handles|turns|engages)\b/i.test(line) && line.length < 140 && !/\?$/.test(line);
}

function capitalise(value: string): string {
  const text = value.trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function clip(value: string, max: number): string {
  const text = cleanExtractText(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}.`;
}

function unique(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function same(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function reset(value: string): string {
  PRICE.lastIndex = 0;
  return value;
}

export function planPreview(plan: PricePlan): string {
  return [plan.name, plan.price, plan.period, plan.includes, plan.overage].filter(Boolean).join(" · ");
}
