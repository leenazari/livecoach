export type BriefQuestion = { question: string; status: "answered" | "partly" | "unanswered" };
export type BriefObjection = { text: string; tag: "Softened" | "Resolved" | "Open"; heat: number };

export type CallBrief = {
  lead: { name: string; email: string | null; phone: string | null; interest: string; cameFrom: string };
  intent: { label: "HOT" | "WARM" | "NURTURE"; reasons: string[]; scale: number };
  appointment: { booked: boolean; when: string | null; agenda: string; bookedBy: string };
  openingLine: string;
  timeline: Array<{ at: string | null; label: string }>;
  howItWent: { summary: string; sentiment: number; engagement: number; talkShareLead: number; mood: string };
  questions: BriefQuestion[];
  objections: BriefObjection[];
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
  talkShareLead: number;
  slides: string[];
  transcript: string;
};

const LABELS = new Set(["HOT", "WARM", "NURTURE"]);

function clip(value: unknown, max: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function intentFromDisposition(disposition: string | null): "HOT" | "WARM" | "NURTURE" {
  if (disposition === "Hot") return "HOT";
  if (disposition === "Warm") return "WARM";
  return "NURTURE";
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
    questions: [],
    objections: [],
    rival: null,
    nextSteps: facts.scheduledAt ? ["Open the meeting with the suggested line."] : ["Decide whether another conversation is useful."],
    source: "record",
  };
}

export function timelineFromFacts(facts: BriefFacts): CallBrief["timeline"] {
  const items: CallBrief["timeline"] = [];
  if (facts.connectedAt) items.push({ at: facts.connectedAt, label: "Call started" });
  for (const slide of facts.slides) items.push({ at: null, label: `Slide shown: ${slide}` });
  if (facts.scheduledAt) items.push({ at: facts.scheduledAt, label: "Meeting booked" });
  if (facts.endedAt) items.push({ at: facts.endedAt, label: "Call ended" });
  return items;
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
  const questions: BriefQuestion[] = Array.isArray(record.questions) ? record.questions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const status: BriefQuestion["status"] = row.status === "answered" || row.status === "partly" || row.status === "unanswered" ? row.status : "partly";
    const question = clip(row.question, 180);
    return question ? [{ question, status }] : [];
  }).slice(0, 8) : [];
  const objections: BriefObjection[] = Array.isArray(record.objections) ? record.objections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = clip(row.text, 180);
    const tag: BriefObjection["tag"] = row.tag === "Softened" || row.tag === "Resolved" || row.tag === "Open" ? row.tag : "Open";
    return text ? [{ text, tag, heat: clamp(row.heat) }] : [];
  }).slice(0, 6) : [];
  const steps = Array.isArray(record.nextSteps) ? record.nextSteps.map((item) => clip(item, 160)).filter(Boolean).slice(0, 4) : [];
  return {
    lead: {
      name: facts.name || clip(lead.name, 160) || "Guest",
      email: facts.email,
      phone: phoneOrNull(lead.phone),
      interest: clip(lead.interest, 180) || base.lead.interest,
      cameFrom: clip(lead.cameFrom, 180) || base.lead.cameFrom,
    },
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
    rival: clip(record.rival, 120) || null,
    nextSteps: steps.length ? steps : base.nextSteps,
    source: "model",
  };
}

export function briefPrompt(facts: BriefFacts): string {
  return `You are writing an internal pre-call brief for the rep who will speak to this person next. Use only the transcript and the facts. Do not invent a phone number, email, price, rival, or promise. If something was not said, use "Not established on this call."
Return JSON with this shape:
{"lead":{"phone":"","interest":"","cameFrom":""},"intent":{"label":"HOT|WARM|NURTURE","reasons":["","",""],"scale":0},"appointment":{"agenda":""},"openingLine":"","howItWent":{"summary":"","sentiment":0,"engagement":0,"mood":""},"questions":[{"question":"","status":"answered|partly|unanswered"}],"objections":[{"text":"","tag":"Softened|Resolved|Open","heat":0}],"rival":"","nextSteps":[""]}
label must match the stored outcome when there is one. reasons must be three short sentences. scale, sentiment, engagement and heat are 0 to 100. openingLine is one sentence the rep can say at the next meeting. rival is empty when none was named.
Facts: name ${facts.name}. email ${facts.email || "none"}. outcome ${facts.disposition || "none"}. reason ${facts.reason || "none"}. timing ${facts.timing || "none"}. meeting ${facts.scheduledAt || "none"}.
Transcript:
${facts.transcript || "No transcript."}`;
}
