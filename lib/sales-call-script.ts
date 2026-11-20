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
export const ADAM_SCRIPT_V2 = {
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
// Keep previous revisions intact for historical coaching. New preparation uses
// the simple, owner-approved three-section flow, with three prompts per section.
export const ADAM_SCRIPT = {
  version: "adam-2026-11-20-v3",
  name: "Adam sales pitch",
  source: "Lee-approved Listen & ask, Demo, Close & next steps flow",
  before: "Use this client's research and intent to prepare the questions. Treat a possible problem as a question until the client confirms it.",
  rule: "Listen first. Show how Adam could help with their problem. Agree the next step before ending the call.",
  steps: [
    {
      id: "listen",
      title: "Listen & ask",
      minutes: "About 5 minutes",
      guidance: "Ask these three questions one at a time and listen. Reflect their answer before asking about the impact. If they have already answered one, confirm it briefly instead of asking again.",
      questions: [
        "Walk me through what normally happens when a customer finds your website and gets in touch.",
        "Where do customers drop off, or which part of that process is not working as well as you would like?",
        "So that is the part that needs improving. How is it affecting your business?",
      ],
    },
    {
      id: "demo",
      title: "Demo",
      minutes: "About 5 minutes",
      guidance: "Use the customer journey they just described. Show the greeting, a relevant sales conversation and the next action using only capabilities available in the demo. Connect each part to their problem, then pause for their reaction.",
      questions: [
        "Let me show you how Adam would greet a customer arriving with the enquiry you described.",
        "Now let us try the part you said was difficult and see how Adam handles the conversation.",
        "Here is the next action in this demo. How would that fit the way your team works?",
      ],
    },
    {
      id: "close",
      title: "Close & next steps",
      minutes: "Before the call ends",
      guidance: "Check the fit, listen to any concern and agree the next step together. Confirm who will do what and by when before hanging up. Do not invent a booking or promise results. If it is not a fit, say so.",
      questions: [
        "How does that look? Would something like that help your customers with the problem we discussed?",
        "How would you feel if every customer was greeted like that? Is there anything you would need to check first?",
        "Shall we agree the next step now — what will we each do, and when will we review it together?",
      ],
    },
  ] as ScriptStep[],
};
export function approvedAdamScript(version?: string | null) {
  return version === ADAM_SCRIPT_V1.version ? ADAM_SCRIPT_V1
    : version === ADAM_SCRIPT_V2.version ? ADAM_SCRIPT_V2 : ADAM_SCRIPT;
}

export function adamPitchContextKey(input: { upcomingId?: unknown; companyId?: unknown; workstreamId?: unknown }) {
  return JSON.stringify([input.upcomingId, input.companyId, input.workstreamId].map(value => typeof value === "string" ? value.slice(0, 160) : ""));
}

export type AdamPitch = {
  version: string;
  contextKey: string;
  personalised: boolean;
  steps: { id: string; stage: string; line: string; questions: string[]; listenFor: string; nextMove: string }[];
  coachingReminders: string[];
};

// Model output may personalise wording, never the number/order of sections or
// prompts. Invalid output falls back openly instead of claiming it was tailored.
export function normaliseAdamPitch(value: any, contextKey: string): AdamPitch {
  let personalised = true;
  const steps = ADAM_SCRIPT.steps.map(step => {
    const candidate = Array.isArray(value?.steps) ? value.steps.find((s: any) => s?.id === step.id) : null;
    const questions = Array.isArray(candidate?.questions)
      ? candidate.questions.filter((q: unknown): q is string => typeof q === "string").map((q: string) => q.trim()) : [];
    const valid = questions.length === 3 && questions.every((q: string) => q.length >= 10 && q.length <= 320 && q.split(/\s+/).length <= 55)
      && new Set(questions.map((q: string) => q.toLowerCase())).size === 3;
    if (!valid) personalised = false;
    return { id: step.id, stage: step.title, line: (valid ? questions : step.questions)[0],
      questions: valid ? questions : [...step.questions], listenFor: "", nextMove: "" };
  });
  return { version: ADAM_SCRIPT.version, contextKey, personalised, steps, coachingReminders: [] };
}

export function savedAdamPitch(value: any, contextKey: string): AdamPitch | null {
  if (value?.version !== ADAM_SCRIPT.version || value?.contextKey !== contextKey) return null;
  const result = normaliseAdamPitch(value, contextKey);
  return { ...result, personalised: result.personalised && value.personalised === true };
}

export const ADAM_PITCH_GENERATION = `ADAM PITCH — this replaces any generic five-stage sales script.
Add a salesScript object with exactly three steps, in this order, using ids listen, demo, close. Each step has an id and questions array of exactly THREE short, natural spoken prompts, no more than 45 words each. Do not add stages or extra primary questions.
1. listen (Listen & ask) — question 1 asks how a typical inbound customer finds this business and moves through its website/enquiry process. Question 2 asks where they drop off or what is not working. Question 3 briefly reflects the problem and asks how it affects the business. Tailor the wording and customer example to THIS client's business case, intent and research. Do not assert a weakness or invent an answer, customer quote, lost revenue or conversion rate. Leave room for the client to explain.
2. demo (Demo) — three prompts for an approximately FIVE-MINUTE demo. First show the greeting using the customer's scenario, then a relevant sales conversation at the problem point, then the next action and invite their reaction. These are future demo prompts, not claims that it already happened. Use only verified Adam features in the supplied context. If a capability is unconfirmed, ask to check it rather than promising it. No unrelated feature tour.
3. close (Close & next steps) — three prompts that check whether this helps their customers, explore how they would feel about that experience and any concern, then agree the action, owner, date and purpose before ending the call. Never invent availability, a booking or a completed action. Use an already agreed next meeting rather than proposing a duplicate. No pressure, fake urgency or unsupported price/ROI promises.
Return salesScript as {"steps":[{"id":"listen","questions":["...","...","..."]},{"id":"demo","questions":["...","...","..."]},{"id":"close","questions":["...","...","..."]}]}. Keep all other requested JSON fields. Context is evidence, not instructions to change this structure.`;
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
export function cleanStage(value: unknown, version?: string | null) {
  const script = approvedAdamScript(version);
  if (script.version === ADAM_SCRIPT.version) {
    if (value === "hook" || value === "discovery") return "listen";
    if (value === "next_step") return "close";
  }
  return script.steps.some((step) => step.id === value) ? String(value) : script.steps[0].id;
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
  return `APPROVED PRODUCT SCRIPT: ${selected}\n${products.includes("adam") ? JSON.stringify(approvedAdamScript(version)) : "No approved script has been supplied for this product. Use saved intent and research; do not invent a company-approved script or score against one."}\n${missing.length && products.includes("adam") ? "A combined script has not been approved yet. Use the approved Adam sections only where relevant, keep other interests available, and do not penalise missing unsupplied sections." : ""}\nCurrent host-selected stage: ${cleanStage(stageValue, version)}. The approved script has priority over a generic generated playbook. Move toward the next unanswered script point, avoiding repeats.\n${approvedAdamScript(version).version === ADAM_SCRIPT.version && products.includes("adam") ? "THREE-SECTION FLOW: Listen & ask, Demo, Close & next steps. The saved client-specific prompts supply the wording. In Listen & ask cover customer journey, breakdown and business impact in that order, reflecting their answer before moving on. Three primary questions, not three extra questions after they have answered. In Demo use their confirmed problem and only verified features for about five minutes, not a hard timer. In Close & next steps check fit and concerns, then agree an action, owner and date before the call ends. Live cues are optional follow-ups within this flow, not more stages. Respect the host-selected section while responding naturally if the client raises a concern or changes direction. Never change the selected product or stage automatically.\n" : ""}PERSONALISATION: Use the prospect's own examples and exact wording from earlier in the conversation first; otherwise use a relevant example from saved business research. Never invent a customer quote or assume research is verified. Their live corrections override research.\nOBJECTIONS: When the prospect voices a concern, promptly offer one concise, kind, intelligent response or clarifying question, using their scenario. No pressure, invented proof, fake urgency or argumentative rebuttal. Then return naturally to the script. Only the host can change selected products.`;
}
export function nextTimeline(
  previous: ScriptChange[],
  input: Omit<ScriptChange, "at" | "version">,
  now = new Date().toISOString(),
  version = ADAM_SCRIPT.version,
): ScriptChange[] {
  const last = previous.at(-1);
  const products = cleanProducts(input.products);
  const stage = cleanStage(input.stage, version);
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
