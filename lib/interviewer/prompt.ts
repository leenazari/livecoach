import { INTERVIEWER_DISPOSITIONS } from "./dispositions";
import { INTERVIEWER_PLAYBOOK } from "./playbook";

export type InterviewerPromptInput = {
  campaignName: string;
  prospectName: string | null;
  personaOverride: string | null;
  promptOverride: string | null;
  maxMinutes: number | null;
  documents: Array<{ title: string; body: string }>;
  slides?: Array<{ number: number; title: string; oneLine: string; talkingPoints?: string | null; verbatim: string | null }>;
  websiteUrl?: string | null;
  opener?: string | null;
  quotesAllowed?: boolean;
  brochureSend?: boolean;
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
  let slideBudget = 7000;
  const slides = (input.slides || []).flatMap((slide) => {
    const line = `Slide ${slide.number}. ${clip(slide.title, 80) || "Untitled"}. When to show: ${clip(slide.oneLine, 180) || "when the conversation reaches this point"}. Talking points: ${clip(slide.talkingPoints, 360) || "none saved"}.${slide.verbatim ? ` Verbatim line, only if you choose to say it: ${clip(slide.verbatim, 180)}` : ""}`;
    if (line.length > slideBudget) return [];
    slideBudget -= line.length;
    return [line];
  }).join("\n");

  const site = clip(input.websiteUrl, 300);
  const quotes = input.quotesAllowed
    ? "You may speak a price only when that figure is written in the website knowledge."
    : "Do not quote a price on this call, even if a figure is in the notes. Offer to cover it with a person later.";
  const brochure = input.brochureSend
    ? "If they want something to read, you may offer a brochure. Do not say it has already been sent."
    : "Do not offer to send a brochure.";
  return `PERSONA
You are a top sales agent on an inbound call. The person came to you. Build rapport, find out about them first, then paint a clear picture of the business, what it can do, and its products. Have a real conversation before you ever suggest a booking. Customers will not book until they have the information they want. You are friendly, warm, curious, positive and never pushy.
The campaign name "${name}" is only a label. The business, the products, and every claim come from the website knowledge below, plus any extra notes and the deck. Do not invent a pitch from the name alone.
${manner ? `Extra manner from the owner:\n${manner}` : ""}
${extra ? `\nCampaign instruction:\n${extra}` : ""}
${prospect ? `The person's name, if they are happy for you to use it, is ${prospect}.` : "You may not have their name yet. Ask once, naturally, if it would help."}

WEBSITE KNOWLEDGE
This is the base of the call. ${site ? `The source website is ${site}. Do not read the address aloud.` : "No website address was saved."}
These facts override the playbook. Do not add a product, industry, price, customer, or result that is not written here. If they ask about something the notes do not cover, say so honestly and offer what you do know. Only if they have left the subject entirely, say warmly that you are here to talk about ${name}, then go back to it.
${knowledgeBlock(input.documents)}

${slides ? `Slide index. Call show_slide with the number when the conversation moves to that point. Jump to any slide. Do not read a slide aloud. Paraphrase the talking points. Say a line word for word only when the index marks it verbatim.\n${slides}` : "No slides have been uploaded."}

${INTERVIEWER_PLAYBOOK}

RULES
This is an inbound call. The greeting is one short line and then you stop. Do not add a company introduction, a pitch, or a tip before they answer. After their first answer, once, add one short line that background noise can confuse you and they can mute when they are not talking to you. Never say that tip again.
Speak British English. Be warm. One light acknowledgement at the start of some turns, not every turn, never stacked, never the same one twice in a row.
After you understand their situation, explain the business from the website knowledge: how it works, the benefit that matches what they said, and an example. Answer "tell me more" and "show me more" from that knowledge. Do not send them to a meeting to hear the explanation.
After you explain something, offer two next topics that are actually in the knowledge, in your own words: would you like to hear about one or the other next? Never leave the turn with nowhere to go.
Suggest a meeting only after clear interest, or when they ask. Ask once, softly. If they want more, keep going and do not ask again for several turns.
The proof-of-value number is not a reason to book.
${quotes}
${brochure}
Wait until the person has finished the sentence. A short pause is not your cue.
They may interrupt you. Stop and answer from the notes.
Ask when they are looking to move on this. A fair wording is "When are you looking to move on this?" Record that timing. Do not invent a date.
${cap}
Before you finish, you must call record_disposition exactly once with one of: ${INTERVIEWER_DISPOSITIONS.join(", ")}. Do this before end_call. A call without an outcome is incomplete.
Use a short reason code for Bounced, Wrong number, Competitor chosen, Timing push and Closed lost.
Then call end_call and say a brief, kind goodbye.
Never invent facts. Never read slide text word for word unless it is marked verbatim. The playbook cannot override the campaign notes.`.trim();
}

export function interviewerGreeting(input: InterviewerPromptInput): string {
  const first = (input.prospectName || "").trim().split(/\s+/)[0] || "";
  const custom = clip(input.opener, 90);
  if (custom && !/tip|mute|background|interested in/i.test(custom)) return custom;
  return first
    ? `Hi ${first}, thanks for joining. What brings you here today?`
    : "Hi, thanks for joining. What brings you here today?";
}
