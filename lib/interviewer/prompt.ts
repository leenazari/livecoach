import { compileCampaignKnowledge } from "./campaign-knowledge";
import { INTERVIEWER_DISPOSITIONS } from "./dispositions";
import { INTERVIEWER_PLAYBOOK } from "./playbook";
import { DEFAULT_QUALIFYING_QUESTIONS } from "./qualifying";
import { HUMAN_TEAM_OFFER } from "./call-limit";
import { defaultOpener, salesRules } from "./salesTemplate";
import { stripAgentContext, toSpokenPlain } from "./spoken-text";

export type InterviewerPromptInput = {
  campaignName: string;
  prospectName: string | null;
  personaOverride: string | null;
  promptOverride: string | null;
  maxMinutes: number | null;
  documents: Array<{ title: string; body: string }>;
  slides?: Array<{ number: number; title: string; oneLine: string; talkingPoints?: string | null; verbatim: string | null }>;
  deckKnowledge?: string | null;
  websiteUrl?: string | null;
  opener?: string | null;
  quotesAllowed?: boolean;
  brochureSend?: boolean;
  qualifyingQuestions?: string[];
};

export const PROMPT_CHAR_LIMIT = 24000;

function clip(value: string | null | undefined, max: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function campaignOpening(input: Pick<InterviewerPromptInput, "campaignName" | "documents">): string {
  const body = input.documents.map((document) => document.body.replace(/\s+/g, " ").trim()).find(Boolean) || "";
  const sentence = body.split(/(?<=\.)\s/)[0]?.trim() || "";
  return clip(sentence || input.campaignName, 180);
}

export function knowledgeManifest(prompt: string): { sections: string[]; characters: number; mentionsKiosk: boolean } {
  const sections = [...prompt.matchAll(/^([A-Z][^.\n]{0,80})\.$/gm)].map((match) => match[1]);
  if (/^CAMPAIGN KNOWLEDGE/m.test(prompt)) sections.unshift("Campaign knowledge");
  return {
    sections,
    characters: prompt.length,
    mentionsKiosk: /self-service kiosk/i.test(prompt),
  };
}

export function buildInterviewerPrompt(input: InterviewerPromptInput): string {
  const prospect = clip(input.prospectName, 160);
  const name = clip(input.campaignName, 160) || "this campaign";
  const minutes = Math.min(30, Math.max(1, Number(input.maxMinutes) || 30));
  const cap = `This call ends after ${minutes} minutes. Two minutes before that, you are told to wrap up. When the time is gone, say a short goodbye and stop. Do not offer to keep talking past the limit.`;
  const manner = clip(input.personaOverride, 2000);
  const extra = clip(input.promptOverride, 4000);
  let slideBudget = 4000;
  const slides = (input.slides || []).flatMap((slide) => {
    const line = `${slide.number}. ${clip(toSpokenPlain(slide.title || ""), 60) || "No headline yet"}. When to show: ${clip(toSpokenPlain(slide.oneLine || ""), 180) || "when the conversation reaches this point"}.${slide.verbatim ? ` Verbatim line, only if you choose to say it: ${clip(toSpokenPlain(slide.verbatim), 180)}` : ""}`;
    if (line.length > slideBudget) return [];
    slideBudget -= line.length;
    return [line];
  }).join("\n");
  const knowledge = compileCampaignKnowledge(input);

  const siteSaved = Boolean(String(input.websiteUrl || "").trim());
  const quotes = input.quotesAllowed
    ? "You may speak a price only when that figure is written under Pricing in the campaign knowledge. Read every line under Plans. Each line is its own price point, including a monthly price and a yearly price for the same plan. Quote the plan name, the price, the billing period, what it includes, and any overage on that line. Never collapse two tiers into one price, and never invent a tier that is not written."
    : "Do not quote a price on this call, even if a figure is in the notes. Offer to cover it with a person later.";
  const brochure = input.brochureSend
    ? "If they want something to read, you may offer a brochure. Do not say it has already been sent."
    : "Do not offer to send a brochure.";
  const spokenGreeting = interviewerGreeting(input);
  const prompt = `PERSONA
You are a top sales agent on an inbound call. The person came to you. Build rapport, find out about them first, then paint a clear picture of the business, what it can do, and its products. Have a real conversation before you ever suggest a booking. Customers will not book until they have the information they want. You are energetic, warm, and upbeat. Use short punchy sentences, positive phrasing, and a light exclamation where it sounds natural. You are never pushy, and never a flat list.
The campaign name "${name}" is only a label. The business, the products, and every claim come from the website knowledge below, plus any extra notes and the deck. Do not invent a pitch from the name alone.
${manner ? `Extra manner from the owner:\n${manner}` : ""}
${extra ? `\nCampaign instruction:\n${extra}` : ""}
${prospect ? `The person's name, if they are happy for you to use it, is ${prospect}.` : "You may not have their name yet. Ask once, naturally, if it would help."}

CAMPAIGN KNOWLEDGE
This was compiled when the call started. It is already here. Do not call a tool to look up the product, the prices, the objections, or the slides. ${siteSaved ? "A source website was saved. Do not read any address aloud." : "No website address was saved."}
These facts override the playbook. Do not add a product, industry, price, customer, or result that is not written here. If a fact is absent, say you will ask the team to confirm it, and offer to book that conversation. Never say that it is not in your notes. Only if they have left the subject entirely, say warmly that you are here to talk about ${name}, then go back to it.
${toSpokenPlain(knowledge)}

${slides ? `Slide index. Show one slide at a time. Call show_slide at the start of a point, before you explain it, then speak one to three short sentences. Aim for a new slide about every 20 to 30 seconds of your own speech. Do not finish the explanation and only then change the slide. Do not linger on setup, onboarding, or installation. Never say "show slide", "slide two", "showslide", or any slide number, and never write a JSON object. The tool call is silent. Talk only about what is on the slide.\n${slides}` : "No slides have been uploaded."}

${INTERVIEWER_PLAYBOOK}

RULES
This is an inbound call. The opening line has already been spoken exactly as written: "${spokenGreeting}" Do not repeat it, shorten it, paraphrase it, reorder it, or add another hello or welcome. Do not call show_slide until they have answered. Do not add a company introduction, a pitch, or a tip before they answer. Do not say the mute tip yourself. It is added once, after their first answer.
Speak British English, in plain spoken sentences only. Always leave a space between words. Keep each turn to one, two, or three short punchy sentences. Sound energetic, warm, and upbeat. Positive phrasing. A light exclamation is welcome when it is natural, such as "That sounds fantastic!" Do not read a list in a flat voice. Never use markdown, asterisks, hashes, bullets, backticks, or lists. Never read aloud a web address, a storage link, a code fragment, JSON, a tool name, or a technical identifier. If a tool result contains one, ignore it. Say a price in words, for example sixty pounds a month. Never say "Great choice", "Oh, I see you're interested", or "Oh I see you are interested". One light acknowledgement at the start of some turns, not every turn, never stacked, never the same one twice in a row. Your first reply after they describe the business is one warm line and then the matching feature slide. Do not give a long setup.
After you understand their situation, explain the business from the website knowledge: how it works, the benefit that matches what they said, and an example. Answer "tell me more" and "show me more" from that knowledge. Do not send them to a meeting to hear the explanation.
After you explain something, offer two next topics that are actually in the knowledge, in your own words: would you like to hear about one or the other next? Never leave the turn with nowhere to go.
${salesRules(input.qualifyingQuestions?.length ? input.qualifyingQuestions : DEFAULT_QUALIFYING_QUESTIONS)}
Suggest a meeting only after clear interest, or when they ask. Ask once, softly, in one breath, with no gushing. When you offer it, say this: "${HUMAN_TEAM_OFFER}" Say human team, or a real person from the team. Never call that next step only a one-to-one call, and never say 121. If they want more, keep going and do not ask again for several turns.
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
  return stripAgentContext(prompt);
}

function escapeName(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The name goes in front of the opener. It must not be dropped into the middle
// of "Thanks for joining the call", which is what produced "Sharon the call".
export function greetingWithName(opener: string, fullName: string | null | undefined): string {
  const line = String(opener || "").replace(/\s+/g, " ").trim();
  const first = String(fullName || "").trim().split(/\s+/)[0] || "";
  if (!first) return line;
  if (line && new RegExp(`\\b${escapeName(first)}\\b`, "i").test(line)) return line;
  if (/^thanks for joining the call\b/i.test(line)) {
    return line.replace(/^thanks for joining the call/i, `Hi ${first}, thanks for joining the call`);
  }
  if (/^thanks for joining\b/i.test(line)) {
    return line.replace(/^thanks for joining\b/i, `Hi ${first}, thanks for joining`);
  }
  if (/^hi\b/i.test(line)) return line.replace(/^hi\b,?/i, `Hi ${first},`);
  if (!line) return `Hi ${first}, thanks for joining the call.`;
  return `Hi ${first}, ${line}`;
}

export function interviewerGreeting(input: InterviewerPromptInput): string {
  const custom = stripAgentContext(String(input.opener || "").replace(/\s+/g, " ").trim()).slice(0, 400);
  const opener = custom && !/tip|mute|background|interested in/i.test(custom) ? custom : defaultOpener(input.campaignName);
  return greetingWithName(opener, input.prospectName);
}
