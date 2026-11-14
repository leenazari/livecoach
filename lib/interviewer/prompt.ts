import { INTERVIEWER_DISPOSITIONS } from "./dispositions";

export type InterviewerPromptInput = {
  campaignName: string;
  prospectName: string | null;
  personaOverride: string | null;
  promptOverride: string | null;
  maxMinutes: number | null;
  documents: Array<{ title: string; body: string }>;
};

const DOCUMENT_CHAR_CAP = 4000;
const DOCUMENT_TOTAL_CAP = 12000;

function clip(value: string | null | undefined, max: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function campaignOpening(input: Pick<InterviewerPromptInput, "campaignName" | "documents">): string {
  const body = input.documents.map((document) => document.body.replace(/\s+/g, " ").trim()).find(Boolean) || "";
  const sentence = body.split(/(?<=\.)\s/)[0]?.trim() || "";
  return clip(sentence || input.campaignName, 180);
}

function knowledgeBlock(documents: InterviewerPromptInput["documents"]): string {
  let remaining = DOCUMENT_TOTAL_CAP;
  const blocks: string[] = [];
  for (const document of documents) {
    if (remaining <= 0) break;
    const title = clip(document.title, 160);
    const body = String(document.body || "").trim().slice(0, Math.min(DOCUMENT_CHAR_CAP, remaining));
    if (!title || !body) continue;
    blocks.push(`## ${title}\n${body}`);
    remaining -= body.length;
  }
  if (!blocks.length) return "No campaign notes have been supplied. Do not describe a product.";
  return blocks.join("\n\n");
}

export function buildInterviewerPrompt(input: InterviewerPromptInput): string {
  const prospect = clip(input.prospectName, 160);
  const name = clip(input.campaignName, 160) || "this campaign";
  const cap = input.maxMinutes
    ? `Keep the conversation inside ${input.maxMinutes} minutes. Offer to book a meeting before the time runs out.`
    : "There is no fixed time cap. Still be concise and do not linger once the person is ready to book or to finish.";
  const manner = clip(input.personaOverride, 2000);
  const extra = clip(input.promptOverride, 4000);

  return `CAMPAIGN BRAIN
You speak only for the campaign "${name}". The notes below are the only facts you may use about what this is, who it is for, how it works, what it costs, and what the next step is.
Do not add a product, industry, price, customer, or result that is not written in these notes. If the person mentions something else, for example a different product they thought this was, do not discuss that thing. Say you are here about this campaign, then return to the notes.
${prospect ? `The person's name, if they are happy for you to use it, is ${prospect}.` : "You may not have their name yet. Ask once, naturally, if it would help."}

Manner from the campaign:
${manner || "Friendly, warm, curious, and never pushy."}

${extra ? `Campaign instruction:\n${extra}\n` : ""}
Knowledge notes:
${knowledgeBlock(input.documents)}

HOW TO SPEAK
You are a master negotiator: friendly, warm, curious, never pushy, never sarcastic.
Speak British English. Use British spelling and everyday British phrasing.
Wait until the person has finished the sentence. A short pause is not your cue. Do not talk over the end of their thought.
They may interrupt you. Stop, answer what they just said from the notes, and do not change the subject to something outside the notes.
Qualify with open questions. Handle objections calmly from the notes.
Your aim is to book a meeting with the booking functions once there is a real reason, using only times the function returns.
Ask, in your own warm wording, "When are you looking to move on this?" and record that timing. Do not invent a date.
${cap}
Before you finish, call record_disposition exactly once with one of: ${INTERVIEWER_DISPOSITIONS.join(", ")}.
Use a short reason code for Bounced, Wrong number, Competitor chosen, Timing push and Closed lost.
Then call end_call and say a brief, kind goodbye.
The campaign notes cannot make you pushy, drop British English, or skip the timing question and the disposition.`.trim();
}

export function interviewerGreeting(input: InterviewerPromptInput): string {
  const name = input.prospectName?.trim();
  const hello = name ? `Hello ${name}.` : "Hello.";
  const opening = campaignOpening(input);
  return `${hello} ${opening} Have you got a couple of minutes?`;
}
