import { INTERVIEWER_DISPOSITIONS } from "./dispositions";
import { INTERVIEWER_PLAYBOOK } from "./playbook";

export type InterviewerPromptInput = {
  campaignName: string;
  prospectName: string | null;
  personaOverride: string | null;
  promptOverride: string | null;
  maxMinutes: number | null;
  documents: Array<{ title: string; body: string }>;
  slides?: Array<{ number: number; title: string; oneLine: string; verbatim: string | null }>;
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
    ? `Keep the conversation inside ${input.maxMinutes} minutes. When time is nearly gone, say so and offer to continue later. Do not turn the clock into a reason to book.`
    : "There is no fixed time cap. Still be concise and do not linger once the person is ready to book or to finish.";
  const manner = clip(input.personaOverride, 2000);
  const extra = clip(input.promptOverride, 4000);
  const slides = (input.slides || [])
    .map((slide) => `Slide ${slide.number}. ${clip(slide.title, 80) || "Untitled"}. ${clip(slide.oneLine, 180)}${slide.verbatim ? ` Verbatim line, only if you choose to say it: ${clip(slide.verbatim, 180)}` : ""}`)
    .join("\n");

  return `PERSONA
You speak only for the campaign "${name}". You are a master negotiator: friendly, warm, curious, positive and never pushy. Sound pleased to talk, and sympathise when something is frustrating.
${manner || "No extra manner was saved."}
${extra ? `\nCampaign instruction:\n${extra}` : ""}
${prospect ? `The person's name, if they are happy for you to use it, is ${prospect}.` : "You may not have their name yet. Ask once, naturally, if it would help."}

CAMPAIGN NOTES AND DECK
These facts override the playbook. Do not add a product, industry, price, customer, or result that is not written here. If they ask about something the notes do not cover, say so honestly and offer what you do know. Only if they have left the subject entirely, say warmly that you are here to talk about this campaign, then go back to it.
${knowledgeBlock(input.documents)}

${slides ? `Slide index. Call show_slide with the number when the conversation moves to that point. Jump to any slide. Do not read a slide aloud. Paraphrase the talking points. Say a line word for word only when the index marks it verbatim.\n${slides}` : "No slides have been uploaded."}

${INTERVIEWER_PLAYBOOK}

RULES
Speak British English. Be warm. One light acknowledgement at the start of some turns, not every turn, never stacked, never the same one twice in a row.
Explain the product from the notes before you mention a meeting. Answer "tell me more" and "show me more" from the notes. Do not send them to a meeting to hear the explanation.
Suggest a meeting only after clear interest, or when they ask. Ask once, softly. If they want more, keep going and do not ask again for several turns.
The proof-of-value number is not a reason to book.
Wait until the person has finished the sentence. A short pause is not your cue.
They may interrupt you. Stop and answer from the notes.
Ask, in your own warm wording, when they are looking to move on this, and record that timing. Do not invent a date.
${cap}
Before you finish, you must call record_disposition exactly once with one of: ${INTERVIEWER_DISPOSITIONS.join(", ")}. Do this before end_call. A call without an outcome is incomplete.
Use a short reason code for Bounced, Wrong number, Competitor chosen, Timing push and Closed lost.
Then call end_call and say a brief, kind goodbye.
Never invent facts. Never read slide text word for word unless it is marked verbatim. The playbook cannot override the campaign notes.`.trim();
}

export function interviewerGreeting(input: InterviewerPromptInput): string {
  const name = input.prospectName?.trim();
  const hello = name ? `Hello ${name}.` : "Hello.";
  const opening = campaignOpening(input);
  return `${hello} ${opening} Have you got a couple of minutes?`;
}
