import { agendaFromLines, catalogFromSlides } from "./interest-agenda";
import { timeLimitChapters } from "./call-limit";

export type BriefQuestion = {
  question: string;
  askedBy?: "lead" | "agent";
  status: "answered" | "partly" | "unanswered";
  answer?: string;
  atSeconds?: number;
};
export type ObjectionOutcome = "positive" | "neutral" | "negative";
export type BriefObjection = {
  text: string;
  tag: "Softened" | "Resolved" | "Open";
  heat: number;
  atSeconds?: number;
  handle?: string;
  outcome?: ObjectionOutcome;
  quote?: string;
};
export type BriefProvider = { name: string; kind: "current" | "competitor"; atSeconds: number };
export type BriefProfile = {
  businessType: string;
  size: string;
  sites: string;
  location: string;
  role: string;
  setup: string;
  painPoints: string;
};
export type ServiceImprovement = { fit: string; suggestion: string };
export type BriefService = { howTheyServe: string; improvements: ServiceImprovement[] };
export type BriefInterest = { label: string; covered: boolean };
export type BriefSlide = {
  number: number;
  title: string;
  atSeconds: number;
  durationSeconds: number;
  triggeredBy: "agent" | "auto" | "lead";
};
export type BriefChapter = { label: string; kind: "question" | "objection" | "provider" | "slide" | "booking" | "end" | "warning" | "limit"; atSeconds: number };
export type BriefLine = { id: string; speaker: "agent" | "lead"; text: string; atSeconds: number };

export type CallBrief = {
  lead: { name: string; email: string | null; phone: string | null; interest: string; cameFrom: string };
  profile?: BriefProfile;
  service?: BriefService;
  interests?: BriefInterest[];
  intent: { label: "HOT" | "WARM" | "NURTURE" | "NOT INTERESTED"; reasons: string[]; scale: number };
  appointment: { booked: boolean; when: string | null; agenda: string; bookedBy: string };
  openingLine: string;
  timeline: Array<{ at: string | null; label: string }>;
  howItWent: { summary: string; sentiment: number; engagement: number; talkShareLead: number; mood: string };
  questions: BriefQuestion[];
  objections: BriefObjection[];
  providers?: BriefProvider[];
  slides?: BriefSlide[];
  chapters?: BriefChapter[];
  lines?: BriefLine[];
  rival: string | null;
  nextSteps: string[];
  source: "model" | "record";
};

export type BriefFacts = {
  name: string;
  email: string | null;
  disposition: string | null;
  reason: string | null;
  timing: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  scheduledAt: string | null;
  durationSeconds?: number;
  limitSeconds?: number;
  talkShareLead: number;
  slides: BriefSlide[];
  lines?: BriefLine[];
  transcript: string;
};

const LABELS = new Set(["HOT", "WARM", "NURTURE", "NOT INTERESTED"]);
const EMPTY = "Not established on this call.";

export function serviceFromTranscript(transcript: string): BriefService {
  const text = transcript.toLowerCase();
  const parts: string[] = [];
  if (/website|visitor|online/.test(text)) parts.push("They talked about how people reach them online.");
  if (/team|staff|people/.test(text)) parts.push("They talked about the team.");
  if (/today|currently|at the moment|using/.test(text)) parts.push("They described what they use today.");
  if (/challenge|problem|frustrat|difficult/.test(text)) parts.push("They named a challenge with the current setup.");
  return {
    howTheyServe: parts.length ? parts.join(" ") : "Not established on this call.",
    improvements: [],
  };
}

function clip(value: unknown, max: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function intentFromDisposition(disposition: string | null): CallBrief["intent"]["label"] {
  if (disposition === "Hot") return "HOT";
  if (disposition === "Warm") return "WARM";
  if (disposition === "Closed lost") return "NOT INTERESTED";
  return "NURTURE";
}

function emptyProfile(): BriefProfile {
  return { businessType: EMPTY, size: EMPTY, sites: EMPTY, location: EMPTY, role: EMPTY, setup: EMPTY, painPoints: EMPTY };
}

const QUESTION_CUE = /\?|(?:^|\b)(?:what|how|where|when|why|who|can you|do you|did they|is there|tell me)\b/i;

const OBJECTION_CUE = /\b(too expensive|no budget|can'?t afford|cannot afford|already have|chatbot|live chat|won'?t talk|will not talk|impersonal|say something wrong|too small|not much (?:website )?traffic|no time|set(?:ting)? up|integrat|gdpr|privacy|data protection|think about it|send me|doesn'?t work|does not work|out of hours|not the decision|decision maker|not right now|too much|pricey)\b/i;
const RESISTANCE = /\b(no thanks|not convinced|still not|still too|too expensive|can'?t afford|cannot afford|don'?t want|do not want|not for us|won'?t work|will not work|not interested)\b/i;
const ACCEPTANCE = /\b(yes|yeah|yep|ok|okay|fair enough|makes sense|that helps|sounds good|let'?s|book|alright|all right|go on|tell me more|interested)\b/i;
const HEDGE = /\b(maybe|not sure|i'?ll think|let me think|perhaps)\b/i;

export function objectionOutcome(reply: string): ObjectionOutcome {
  const text = reply.replace(/\s+/g, " ").trim();
  if (!text) return "neutral";
  if (RESISTANCE.test(text) || OBJECTION_CUE.test(text)) return "negative";
  if (HEDGE.test(text)) return "neutral";
  if (ACCEPTANCE.test(text)) return "positive";
  return "positive";
}

export function objectionsFromLines(lines: BriefLine[]): BriefObjection[] {
  const found: BriefObjection[] = [];
  lines.forEach((line, index) => {
    if (line.speaker !== "lead" || !OBJECTION_CUE.test(line.text)) return;
    const words = clip(line.text, 180);
    if (!words || found.some((item) => item.text.toLowerCase() === words.toLowerCase())) return;
    const after = lines.slice(index + 1);
    const agent = after.find((next) => next.speaker === "agent");
    const agentIndex = agent ? after.indexOf(agent) : -1;
    const reply = after.slice(agentIndex + 1).find((next) => next.speaker === "lead");
    const quote = reply ? clip(reply.text, 180) : "";
    found.push({
      text: words,
      tag: quote && objectionOutcome(quote) === "negative" ? "Open" : "Softened",
      heat: quote && objectionOutcome(quote) === "negative" ? 70 : 30,
      atSeconds: line.atSeconds,
      handle: agent ? clip(agent.text, 220) : "",
      outcome: reply ? objectionOutcome(quote) : "neutral",
      quote,
    });
  });
  return found.slice(0, 12);
}

export function objectionCountLabel(items: Array<Pick<BriefObjection, "outcome">>): string {
  if (!items.length) return "None raised";
  const positive = items.filter((item) => item.outcome === "positive").length;
  const raised = items.length === 1 ? "1 raised" : `${items.length} raised`;
  const handled = positive === 1 ? "1 handled positively" : `${positive} handled positively`;
  return `${raised}, ${handled}`;
}

export function questionsFromLines(lines: BriefLine[]): BriefQuestion[] {
  const questions: BriefQuestion[] = [];
  lines.forEach((line, index) => {
    if (/are you still there/i.test(line.text) || !QUESTION_CUE.test(line.text)) return;
    const askedBy = line.speaker === "lead" ? "lead" : "agent";
    const reply = lines.slice(index + 1).find((next) => next.speaker !== line.speaker);
    const answer = reply ? clip(reply.text, 220) : "";
    questions.push({
      question: clip(line.text, 220),
      askedBy,
      answer,
      status: answer ? "answered" : "unanswered",
      atSeconds: line.atSeconds,
    });
  });
  return questions;
}

function providersFromLines(lines: BriefLine[]): BriefProvider[] {
  const found: BriefProvider[] = [];
  for (const line of lines) {
    if (line.speaker !== "lead") continue;
    const named = line.text.match(/\b(?:use|using|on|with)\s+([A-Z][A-Za-z0-9]+)\b/);
    if (!named) continue;
    if (found.some((item) => item.name.toLowerCase() === named[1].toLowerCase())) continue;
    found.push({ name: named[1], kind: "current", atSeconds: line.atSeconds });
  }
  return found;
}

function phoneOrNull(value: unknown): string | null {
  const text = clip(value, 40);
  if (!text || !/\d{6,}/.test(text.replace(/\D/g, ""))) return null;
  return text;
}

export function talkShareLead(lines: Array<{ speaker: string; text: string }>): number {
  let lead = 0;
  let agent = 0;
  for (const line of lines) {
    const words = line.text.trim().split(/\s+/).filter(Boolean).length;
    if (line.speaker === "lead") lead += words;
    else agent += words;
  }
  const total = lead + agent;
  if (!total) return 0;
  return Math.round((lead / total) * 100);
}

export function fallbackBrief(facts: BriefFacts): CallBrief {
  const label = intentFromDisposition(facts.disposition);
  const reasons = [
    facts.disposition ? `The call was recorded as ${facts.disposition}.` : "No outcome was stored on the call.",
    facts.reason || "No extra reason was stored.",
    facts.timing || "No timing was captured.",
  ];
  return {
    lead: {
      name: facts.name || "Guest",
      email: facts.email,
      phone: null,
      interest: "Not established on this call.",
      cameFrom: "Not established on this call.",
    },
    intent: { label, reasons, scale: label === "HOT" ? 80 : label === "WARM" ? 55 : 30 },
    appointment: {
      booked: Boolean(facts.scheduledAt),
      when: facts.scheduledAt,
      agenda: facts.scheduledAt ? "Follow up on what they asked about." : "No meeting was booked.",
      bookedBy: facts.scheduledAt ? "Booked from this call onto the owner's calendar." : "No meeting booked.",
    },
    openingLine: facts.name
      ? `Hello ${facts.name}. What brought you back today?`
      : "Hello. What brought you here today?",
    timeline: timelineFromFacts(facts),
    howItWent: {
      summary: facts.transcript ? "The transcript is saved. A model summary was not stored." : "This call has no transcript yet.",
      sentiment: 50,
      engagement: facts.transcript ? 40 : 0,
      talkShareLead: facts.talkShareLead,
      mood: "Not scored",
    },
    profile: emptyProfile(),
    service: serviceFromTranscript(facts.transcript),
    interests: agendaFromLines(facts.lines || [], catalogFromSlides(facts.slides || [])).map((item) => ({ label: item.label, covered: item.covered })),
    questions: questionsFromLines(facts.lines || []),
    objections: objectionsFromLines(facts.lines || []),
    providers: providersFromLines(facts.lines || []),
    slides: facts.slides || [],
    chapters: [],
    lines: facts.lines || [],
    rival: null,
    nextSteps: facts.scheduledAt ? ["Open the meeting with the suggested line."] : ["Decide whether another conversation is useful."],
    source: "record",
  };
}

export function timelineFromFacts(facts: BriefFacts): CallBrief["timeline"] {
  const items: CallBrief["timeline"] = [];
  if (facts.connectedAt) items.push({ at: facts.connectedAt, label: "Call started" });
  for (const slide of facts.slides || []) {
    const title = typeof slide === "string" ? slide : slide.title || `Slide ${slide.number}`;
    items.push({ at: null, label: `Slide shown: ${title}` });
  }
  if (facts.scheduledAt) items.push({ at: facts.scheduledAt, label: "Meeting booked" });
  if (facts.endedAt) items.push({ at: facts.endedAt, label: "Call ended" });
  return items;
}

function mergeQuestions(fromLines: BriefQuestion[], fromModel: BriefQuestion[]): BriefQuestion[] {
  if (!fromLines.length) return fromModel;
  return fromLines.map((line) => {
    const match = fromModel.find((item) => item.atSeconds === line.atSeconds || item.question.toLowerCase().slice(0, 24) === line.question.toLowerCase().slice(0, 24));
    return match ? { ...line, answer: match.answer || line.answer, status: match.status } : line;
  });
}

export function buildChapters(input: {
  questions: BriefQuestion[];
  objections: BriefObjection[];
  providers: BriefProvider[];
  slides: BriefSlide[];
  booked: boolean;
  endedAtSeconds: number;
  limitSeconds?: number;
}): BriefChapter[] {
  const chapters: BriefChapter[] = [
    ...input.questions.map((item) => ({ label: item.question, kind: "question" as const, atSeconds: item.atSeconds || 0 })),
    ...input.objections.map((item) => ({ label: item.text, kind: "objection" as const, atSeconds: item.atSeconds || 0 })),
    ...input.providers.map((item) => ({ label: `${item.kind === "current" ? "Uses" : "Mentioned"} ${item.name}`, kind: "provider" as const, atSeconds: item.atSeconds })),
    ...input.slides.map((item) => ({ label: item.title || `Slide ${item.number}`, kind: "slide" as const, atSeconds: item.atSeconds })),
  ];
  if (input.booked) chapters.push({ label: "Booking", kind: "booking", atSeconds: input.endedAtSeconds });
  if (input.limitSeconds) chapters.push(...timeLimitChapters(input.endedAtSeconds, input.limitSeconds));
  if (input.endedAtSeconds) chapters.push({ label: "Call ended", kind: "end", atSeconds: input.endedAtSeconds });
  return chapters.sort((left, right) => left.atSeconds - right.atSeconds);
}

export function parseBrief(raw: unknown, facts: BriefFacts): CallBrief {
  const base = fallbackBrief(facts);
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const lead = record.lead && typeof record.lead === "object" ? record.lead as Record<string, unknown> : {};
  const intent = record.intent && typeof record.intent === "object" ? record.intent as Record<string, unknown> : {};
  const appointment = record.appointment && typeof record.appointment === "object" ? record.appointment as Record<string, unknown> : {};
  const how = record.howItWent && typeof record.howItWent === "object" ? record.howItWent as Record<string, unknown> : {};
  const label = LABELS.has(String(intent.label)) ? String(intent.label) as CallBrief["intent"]["label"] : base.intent.label;
  const reasons = Array.isArray(intent.reasons) ? intent.reasons.map((item) => clip(item, 180)).filter(Boolean) : [];
  while (reasons.length < 3) reasons.push("Not established on this call.");
  const modelQuestions: BriefQuestion[] = Array.isArray(record.questions) ? record.questions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const status: BriefQuestion["status"] = row.status === "answered" || row.status === "partly" || row.status === "unanswered" ? row.status : "partly";
    const question = clip(row.question, 220);
    const askedBy = row.askedBy === "agent" ? "agent" : "lead";
    return question ? [{ question, askedBy, status, answer: clip(row.answer, 220), atSeconds: Number(row.atSeconds) || 0 }] : [];
  }) : [];
  const questions = mergeQuestions(questionsFromLines(facts.lines || []), modelQuestions);
  const fromLines = objectionsFromLines(facts.lines || []);
  const fromModel: BriefObjection[] = Array.isArray(record.objections) ? record.objections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = clip(row.text, 180);
    if (!text || /no objections/i.test(text)) return [];
    const tag: BriefObjection["tag"] = row.tag === "Softened" || row.tag === "Resolved" || row.tag === "Open" ? row.tag : "Open";
    const stated = row.outcome === "positive" || row.outcome === "neutral" || row.outcome === "negative" ? row.outcome : tag === "Open" ? "negative" : "positive";
    return [{
      text,
      tag,
      heat: clamp(row.heat),
      atSeconds: Number(row.atSeconds) || 0,
      handle: clip(row.handle, 220),
      outcome: stated,
      quote: clip(row.quote, 180),
    }];
  }) : [];
  const objections = fromLines.length ? fromLines : fromModel;
  const profileRecord = record.profile && typeof record.profile === "object" ? record.profile as Record<string, unknown> : {};
  const profile: BriefProfile = {
    businessType: clip(profileRecord.businessType, 80) || base.profile?.businessType || EMPTY,
    size: clip(profileRecord.size, 80) || EMPTY,
    sites: clip(profileRecord.sites, 80) || EMPTY,
    location: clip(profileRecord.location, 80) || EMPTY,
    role: clip(profileRecord.role, 80) || EMPTY,
    setup: clip(profileRecord.setup, 160) || EMPTY,
    painPoints: clip(profileRecord.painPoints, 220) || EMPTY,
  };
  const providers: BriefProvider[] = Array.isArray(record.providers) && record.providers.length
    ? record.providers.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const name = clip(row.name, 80);
      if (!name) return [];
      return [{ name, kind: row.kind === "competitor" ? "competitor" as const : "current" as const, atSeconds: Number(row.atSeconds) || 0 }];
    })
    : (base.providers || []);
  const steps = Array.isArray(record.nextSteps) ? record.nextSteps.map((item) => clip(item, 160)).filter(Boolean).slice(0, 4) : [];
  const serviceRecord = record.service && typeof record.service === "object" ? record.service as Record<string, unknown> : {};
  const modelImprovements: ServiceImprovement[] = Array.isArray(serviceRecord.improvements) ? serviceRecord.improvements.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const suggestion = clip(row.suggestion, 220);
    if (!suggestion) return [];
    return [{ fit: clip(row.fit, 80) || "Fit", suggestion }];
  }) : [];
  const service: BriefService = {
    howTheyServe: clip(serviceRecord.howTheyServe, 400) || base.service?.howTheyServe || EMPTY,
    improvements: modelImprovements.length ? modelImprovements : (base.service?.improvements || []),
  };
  const modelInterests: BriefInterest[] = Array.isArray(record.interests) ? record.interests.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = clip(row.label, 80);
    if (!label) return [];
    return [{ label, covered: row.covered === true }];
  }) : [];
  const interests = modelInterests.length ? modelInterests : (base.interests || []);
  return {
    lead: {
      name: facts.name || clip(lead.name, 160) || "Guest",
      email: facts.email,
      phone: phoneOrNull(lead.phone),
      interest: clip(lead.interest, 180) || base.lead.interest,
      cameFrom: clip(lead.cameFrom, 180) || base.lead.cameFrom,
    },
    profile,
    service,
    interests,
    intent: { label, reasons: reasons.slice(0, 3), scale: clamp(intent.scale ?? base.intent.scale) },
    appointment: {
      booked: Boolean(facts.scheduledAt),
      when: facts.scheduledAt,
      agenda: clip(appointment.agenda, 200) || base.appointment.agenda,
      bookedBy: facts.scheduledAt ? "Booked from this call onto the owner's calendar." : "No meeting booked.",
    },
    openingLine: clip(record.openingLine, 240) || base.openingLine,
    timeline: timelineFromFacts(facts),
    howItWent: {
      summary: clip(how.summary, 500) || base.howItWent.summary,
      sentiment: clamp(how.sentiment),
      engagement: clamp(how.engagement),
      talkShareLead: facts.talkShareLead,
      mood: clip(how.mood, 40) || "Not scored",
    },
    questions,
    objections,
    providers,
    slides: facts.slides || [],
    lines: facts.lines || [],
    chapters: buildChapters({ questions, objections, providers, slides: facts.slides || [], booked: Boolean(facts.scheduledAt), endedAtSeconds: facts.durationSeconds || 0, limitSeconds: facts.limitSeconds }),
    rival: providers[0]?.name || clip(record.rival, 120) || null,
    nextSteps: steps.length ? steps : base.nextSteps,
    source: "model",
  };
}

export function briefPrompt(facts: BriefFacts): string {
  return `You are writing an internal pre-call brief. Use only the transcript. Do not invent a phone number, email, price, provider, objection, or promise. If it was not said, use "Not established on this call."
Choose intent.label from the transcript: HOT if they booked or were ready to buy, WARM if they engaged and a next conversation is likely, NOT INTERESTED if they declined, otherwise NURTURE. The first reason is one sentence a rep can read.
Return JSON:
{"lead":{"phone":"","interest":"","cameFrom":""},"profile":{"businessType":"","size":"","sites":"","location":"","role":"","setup":"","painPoints":""},"service":{"howTheyServe":"","improvements":[{"fit":"","suggestion":""}]},"interests":[{"label":"","covered":false}],"intent":{"label":"HOT|WARM|NURTURE|NOT INTERESTED","reasons":["","",""],"scale":0},"appointment":{"agenda":""},"openingLine":"","howItWent":{"summary":"","sentiment":0,"engagement":0,"mood":""},"questions":[{"question":"","askedBy":"lead|agent","answer":"","status":"answered|partly|unanswered","atSeconds":0}],"objections":[{"text":"","handle":"","outcome":"positive|neutral|negative","quote":"","tag":"Softened|Resolved|Open","heat":0,"atSeconds":0}],"providers":[{"name":"","kind":"current|competitor","atSeconds":0}],"nextSteps":[""]}
Include every question. askedBy is lead when the customer asked, and agent when Interviewa asked. For a lead question, answer is one sentence summarising what the agent said. For an agent question, answer is a short quote or paraphrase of what the lead actually replied. If nobody replied, status is unanswered and answer is empty. Copy atSeconds from the transcript tag. objections lists each pushback the lead actually said. text is their words. handle is the reply the agent gave. outcome is positive if they accepted it or moved on, neutral if they only hedged, and negative if they were still resistant. quote is a short line from their response. Leave objections empty when none were raised. Do not invent an objection. providers lists who they use today and any competitor they named. service.howTheyServe is how they work today, in their words. service.improvements lists only gains that fit what they said and that appear in the deck. Leave improvements empty if they did not describe the current process. Do not name a product that is not in the transcript. interests lists each feature or need the lead named, in that order. covered is true only if the agent actually showed or explained it.
Facts: name ${facts.name}. email ${facts.email || "none"}. stored outcome ${facts.disposition || "none"}. meeting ${facts.scheduledAt || "none"}.
Transcript, times are seconds from the start:
${facts.transcript || "No transcript."}`;
}
