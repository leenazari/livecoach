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
export const ADAM_SCRIPT_V1 = {
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
export const ADAM_SCRIPT = {
  ...ADAM_SCRIPT_V1,
  version: "adam-2026-11-19-v2",
  name: "Adam: problem, impact, proof and next step",
  source: "Refined from Lee's Adam demo script following the sales-flow review",
  before:
    "Review the prospect's business, outreach reply and call intent. Pick one grounded opening, one likely problem to check, and a relevant demo scenario. Treat research as a hypothesis until the prospect confirms it.",
  rule: "Understand the problem and its impact. Demonstrate one relevant outcome. Agree who does what by when.",
  steps: [
    {
      id: "hook",
      title: "Agree the purpose",
      minutes: "0–2 min",
      guidance:
        "Use their own example or a verified business detail, then agree what would make this conversation useful. Explain Adam briefly using approved product facts. Do not assume they have a problem or launch into features.",
      questions: [
        "What prompted you to look at this now?",
        "What would make these fifteen minutes useful for you?",
      ],
    },
    {
      id: "discovery",
      title: "Problem and business impact",
      minutes: "2–6 min",
      guidance:
        "Start with how it works today and one real example. Follow only the unanswered gaps: frequency, business impact and what they want instead. Two opening questions are a starting point, not a hard limit. Listen, reflect their words, and avoid asking again when prep or the call already provides the answer. Use their figures only, never invent an ROI.",
      questions: [
        "Talk me through what happened with your last website enquiry.",
        "Where does that process tend to break down?",
        "When that happens, what does it mean for the business?",
        "What would a useful improvement look like?",
      ],
    },
    {
      id: "demo",
      title: "Show their situation",
      minutes: "6–10 min",
      guidance:
        "Confirm their problem back in their words, then demonstrate ONE relevant situation from their answers. Use their customer, sector and scenario. Show only verified Adam capabilities. Stop and invite a reaction, including what does not fit. A transcript alone cannot verify what was shown on screen.",
      questions: [
        "How would that work with the example you just gave me?",
        "What would need to change for your team?",
      ],
    },
    {
      id: "close",
      title: "Resolve the concern and decision",
      minutes: "10–13 min",
      guidance:
        "Check the demonstrated outcome against their stated problem and success criteria. If hesitant, acknowledge the concern and clarify what is underneath it, then give one grounded response and check it helped. Find out who else is involved and what needs to be checked before a decision. Quote only the supplied offer and clarify what it covers: Rebelk is £39, set up today, leads flowing by tomorrow morning. Never invent a billing period, discount, ROI, capability or guarantee. Check setup prerequisites and availability before promising timing.",
      questions: [
        "Does that solve the issue you described?",
        "What is the main thing you would need to feel comfortable?",
        "Who else needs to be involved in deciding this?",
      ],
    },
    {
      id: "next_step",
      title: "Agree a mutual next step",
      minutes: "13–15 min",
      guidance:
        "Choose the right outcome: an agreed next step for a fit, a specific check for an unresolved question, or an honest no-fit. Agree the action, owner, date, time if relevant and purpose in the prospect's words. For an already booked meeting, confirm it rather than proposing another. If no date is agreed, record that gap. Do not invent Thursday at ten or claim a booking, proposal or email is already done. Recap both sides' commitments so LiveCoach can prepare the work after the call.",
      questions: [
        "What is the most useful next step from here?",
        "What shall we each do before we speak again?",
        "When should we review that together?",
      ],
    },
  ] as ScriptStep[],
};
export function approvedAdamScript(version?: string | null) {
  return version === ADAM_SCRIPT_V1.version ? ADAM_SCRIPT_V1 : ADAM_SCRIPT;
}
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
  version?: string | null,
): string {
  const products = cleanProducts(productsValue);
  if (!products.length) return "";
  const selected = SALES_PRODUCTS.filter((p) => products.includes(p.id))
    .map((p) => p.label)
    .join(" + ");
  const missing = products.filter((p) => p !== "adam");
  return `APPROVED PRODUCT SCRIPT: ${selected}\n${products.includes("adam") ? JSON.stringify(approvedAdamScript(version)) : "No approved script has been supplied for this product. Use saved intent and research; do not invent a company-approved script or score against one."}\n${missing.length && products.includes("adam") ? "A combined script has not been approved yet. Use the approved Adam sections only where relevant, keep other interests available, and do not penalise missing unsupplied sections." : ""}\nCurrent host-selected stage: ${cleanStage(stageValue)}. The approved script has priority over a generic generated playbook. Move toward the next unanswered script point, avoiding repeats.\nPERSONALISATION: Use the prospect\'s own examples and exact wording from earlier in the conversation first; otherwise use a relevant example from saved business research. Never invent a customer quote or assume research is verified. Their live corrections override research.\nOBJECTIONS: When the prospect voices a concern, promptly offer one concise, kind, intelligent response or clarifying question, using their scenario. No pressure, invented proof, fake urgency or argumentative rebuttal. Then return naturally to the script. Only the host can change selected products.`;
}
export function nextTimeline(
  previous: ScriptChange[],
  input: Omit<ScriptChange, "at" | "version">,
  now = new Date().toISOString(),
  version = ADAM_SCRIPT.version,
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
      version: products.includes("adam") ? approvedAdamScript(version).version : null,
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
