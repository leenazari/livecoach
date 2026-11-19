export const SALES_PRODUCTS = [
  { id: "adam", label: "Adam sales agent" },
  { id: "recruitment", label: "Recruitment" },
  { id: "training", label: "Training" },
  { id: "other", label: "Other" },
] as const;
export type SalesProduct = (typeof SALES_PRODUCTS)[number]["id"];
export type ScriptStep = {
  id: string;
  title: string;
  minutes: string;
  guidance: string;
  questions: string[];
};
export const ADAM_SCRIPT = {
  version: "adam-2026-11-19-v1",
  name: "Adam demo: 15 minutes",
  source: "Lee-approved Adam Demo Script - 15 Minutes",
  rule: "Never pitch features. Pitch the moment a lead almost slipped away.",
  before:
    "Review the outreach reply. Pick one specific thing the prospect mentioned for your opening.",
  steps: [
    {
      id: "hook",
      title: "Personalised opening",
      minutes: "0–1 min",
      guidance:
        "Use their name and the specific thing they mentioned. Explain Adam in one sentence.",
      questions: [
        "I noticed you mentioned [their example]. That is exactly what Adam catches in real time.",
      ],
    },
    {
      id: "discovery",
      title: "Discovery",
      minutes: "1–4 min",
      guidance:
        "Two discovery questions maximum. Their answers become the demo scenario. Do not ask again if already answered.",
      questions: [
        "What's your current process when a lead lands?",
        "Where do most of those leads go cold?",
      ],
    },
    {
      id: "demo",
      title: "Relevant live demo",
      minutes: "4–10 min",
      guidance:
        "Screen share one real scenario from their answers. Show Adam catching a missed lead or replying in seconds. Then stop and listen. A transcript cannot prove what was shown on screen.",
      questions: ["What would you change?"],
    },
    {
      id: "close",
      title: "Value and objection",
      minutes: "10–13 min",
      guidance:
        "Check whether it solves their problem. Current approved offer: Rebelk is £39, set up today, leads flowing by tomorrow morning. Do not invent a billing period, discount, proof or guarantee. If hesitant, acknowledge the one objection in their words and respond calmly.",
      questions: ["Does this solve what you just described?"],
    },
    {
      id: "next_step",
      title: "Book the next step",
      minutes: "13–15 min",
      guidance:
        "Agree a specific follow-up before hanging up, with a date, time and purpose.",
      questions: ["Shall we book Thursday at ten to review your first batch?"],
    },
  ] as ScriptStep[],
};
export type ScriptChange = {
  at: string;
  elapsedSeconds: number;
  transcriptChars: number;
  products: SalesProduct[];
  stage: string;
  version: string | null;
};
export function cleanProducts(value: unknown): SalesProduct[] {
  if (!Array.isArray(value)) return [];
  return SALES_PRODUCTS.filter((product) => value.includes(product.id)).map(
    (product) => product.id,
  );
}
export function cleanStage(value: unknown) {
  return ADAM_SCRIPT.steps.some((step) => step.id === value)
    ? String(value)
    : "hook";
}
export function scriptContext(
  productsValue: unknown,
  stageValue: unknown,
): string {
  const products = cleanProducts(productsValue);
  if (!products.length) return "";
  const selected = SALES_PRODUCTS.filter((p) => products.includes(p.id))
    .map((p) => p.label)
    .join(" + ");
  const missing = products.filter((p) => p !== "adam");
  return `APPROVED PRODUCT SCRIPT: ${selected}\n${products.includes("adam") ? JSON.stringify(ADAM_SCRIPT) : "No approved script has been supplied for this product. Use saved intent and research; do not invent a company-approved script or score against one."}\n${missing.length && products.includes("adam") ? "A combined script has not been approved yet. Use the approved Adam sections only where relevant, keep other interests available, and do not penalise missing unsupplied sections." : ""}\nCurrent host-selected stage: ${cleanStage(stageValue)}. The approved script has priority over a generic generated playbook. Move toward the next unanswered script point, avoiding repeats.\nPERSONALISATION: Use the prospect\'s own examples and exact wording from earlier in the conversation first; otherwise use a relevant example from saved business research. Never invent a customer quote or assume research is verified. Their live corrections override research.\nOBJECTIONS: When the prospect voices a concern, promptly offer one concise, kind, intelligent response or clarifying question, using their scenario. No pressure, invented proof, fake urgency or argumentative rebuttal. Then return naturally to the script. Only the host can change selected products.`;
}
export function nextTimeline(
  previous: ScriptChange[],
  input: Omit<ScriptChange, "at" | "version">,
  now = new Date().toISOString(),
): ScriptChange[] {
  const last = previous.at(-1);
  const products = cleanProducts(input.products);
  const stage = cleanStage(input.stage);
  if (
    last &&
    JSON.stringify(last.products) === JSON.stringify(products) &&
    last.stage === stage
  )
    return previous;
  return [
    ...previous,
    {
      ...input,
      products,
      stage,
      at: now,
      version: products.includes("adam") ? ADAM_SCRIPT.version : null,
    },
  ].slice(-100);
}
export function coachingScore(criteria: any[]): number | null {
  const eligible = criteria.filter((c) =>
    ["met", "partial", "missed"].includes(c.status),
  );
  if (!eligible.length) return null;
  return Math.round(
    (100 *
      eligible.reduce(
        (sum, c) =>
          sum + (c.status === "met" ? 1 : c.status === "partial" ? 0.5 : 0),
        0,
      )) /
      eligible.length,
  );
}
export function isSpokenObjection(text: string) {
  return /\b(too expensive|can.t afford|no budget|not interested|don.t need|already (?:have|use)|not (?:sure|comfortable|convinced)|worried|concern(?:ed)?|won.t work|don.t trust|no time|not enough time|think about it|send (?:me|us) (?:an? )?(?:email|information)|speak to (?:my|our) (?:boss|partner)|costs? too much)\b/i.test(
    text,
  );
}
