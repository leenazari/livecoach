import { timeLimitChapters } from "./call-limit";

export type BriefQuestion = {
  question: string;
  status: "answered" | "partly" | "unanswered";
  answer?: string;
  atSeconds?: number;
};
export type BriefObjection = { text: string; tag: "Softened" | "Resolved" | "Open"; heat: number; atSeconds?: number };
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

export function questionsFromLines(lines: BriefLine[]): BriefQuestion[] {
  const questions: BriefQuestion[] = [];
  lines.forEach((line, index) => {
    if (line.speaker !== "lead" || !/\?|(?:^|\b)(?:what|how|where|when|why|who|can you|do you|did they|is there)\b/i.test(line.text)) return;
    const answer = lines.slice(index + 1).find((next) => next.speaker === "agent");
    questions.push({
      question: clip(line.text, 220),
      answer: answer ? clip(answer.text, 220) : "No answer was captured.",
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
    questions: questionsFromLines(facts.lines || []),
    objections: [],
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
    return question ? [{ question, status, answer: clip(row.answer, 220), atSeconds: Number(row.atSeconds) || 0 }] : [];
  }) : [];
  const questions = mergeQuestions(questionsFromLines(facts.lines || []), modelQuestions);
  const objections: BriefObjection[] = Array.isArray(record.objections) ? record.objections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = clip(row.text, 180);
    if (!text || /no objections/i.test(text)) return [];
    const tag: BriefObjection["tag"] = row.tag === "Softened" || row.tag === "Resolved" || row.tag === "Open" ? row.tag : "Open";
    return [{ text, tag, heat: clamp(row.heat), atSeconds: Number(row.atSeconds) || 0 }];
  }) : [];
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
  return {
    lead: {
      name: facts.name || clip(lead.name, 160) || "Guest",
      email: facts.email,
      phone: phoneOrNull(lead.phone),
      interest: clip(lead.interest, 180) || base.lead.interest,
      cameFrom: clip(lead.cameFrom, 180) || base.lead.cameFrom,
    },
    profile,
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
{"lead":{"phone":"","interest":"","cameFrom":""},"profile":{"businessType":"","size":"","sites":"","location":"","role":"","setup":"","painPoints":""},"intent":{"label":"HOT|WARM|NURTURE|NOT INTERESTED","reasons":["","",""],"scale":0},"appointment":{"agenda":""},"openingLine":"","howItWent":{"summary":"","sentiment":0,"engagement":0,"mood":""},"questions":[{"question":"","answer":"","status":"answered|partly|unanswered","atSeconds":0}],"objections":[{"text":"","tag":"Softened|Resolved|Open","heat":0,"atSeconds":0}],"providers":[{"name":"","kind":"current|competitor","atSeconds":0}],"nextSteps":[""]}
Include every lead question, copying atSeconds from the transcript tag. objections is an empty array when none were raised. providers lists who they use today and any competitor they named.
Facts: name ${facts.name}. email ${facts.email || "none"}. stored outcome ${facts.disposition || "none"}. meeting ${facts.scheduledAt || "none"}.
Transcript, times are seconds from the start:
${facts.transcript || "No transcript."}`;
}
