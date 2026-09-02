export const OUTREACH_EMAIL_DEMO_REPLY_CTA =
  "If you would like to book a quick demo, just reply to this email and I will arrange it.";

export const OUTREACH_VOICE_DEMO_REPLY_CTA =
  "If you would like to book a quick demo, just reply to this email and we will arrange it.";

export const OUTREACH_SIMPLE_OPT_OUT =
  "If this is not relevant, tell me and I will not follow up.";

const DEMO_REPLY_CTA =
  /\bbook(?:ing)?\s+(?:a\s+)?quick\s+demo\b[\s\S]{0,180}\brepl(?:y|ying)\s+to\s+this\s+email\b|\brepl(?:y|ying)\s+to\s+this\s+email\b[\s\S]{0,180}\bbook(?:ing)?\s+(?:a\s+)?quick\s+demo\b/i;
const SIMPLE_OPT_OUT = /(not|won't|will not|do not).{0,24}follow up/i;
const COMMON_SIGN_OFF =
  /^(?:best|thanks|thank you|kind regards|regards|best wishes|cheers)[,!]?$/i;
const PERSON_NAME =
  /^[\p{Lu}][\p{L}'’.]+(?:\s+[\p{Lu}][\p{L}'’.]+){0,3}$/u;

const cleanParagraph = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

const normalised = (value: unknown) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const comparable = (value: unknown) =>
  normalised(value).replace(/\s+/g, " ").toLocaleLowerCase("en-GB");

export function hasOutreachDemoReplyCta(value: unknown): boolean {
  return DEMO_REPLY_CTA.test(normalised(value));
}

function looksLikeSignature(paragraph: string, signoff?: string): boolean {
  const compact = comparable(paragraph);
  const exactSignoff = comparable(signoff);
  if (
    exactSignoff &&
    (compact === exactSignoff || compact.endsWith(` ${exactSignoff}`)) &&
    paragraph.length <= 220
  ) {
    return true;
  }

  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 4 || paragraph.length > 160) return false;
  if (lines.length >= 2 && COMMON_SIGN_OFF.test(lines[0])) return true;
  if (lines.length >= 2 && PERSON_NAME.test(lines[0])) return true;
  return lines.length === 1 && PERSON_NAME.test(lines[0]);
}

function trimAtSentenceBoundary(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  if (maximum <= 0) return "";
  const candidate = value.slice(0, maximum).trimEnd();
  const boundary = Math.max(
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("?"),
    candidate.lastIndexOf("!")
  );
  if (boundary >= Math.floor(maximum * 0.6)) {
    return candidate.slice(0, boundary + 1).trim();
  }
  const wordBoundary = candidate.lastIndexOf(" ");
  return candidate.slice(0, wordBoundary > 0 ? wordBoundary : maximum).trim();
}

function formatOutreachEmailEnding(input: {
  body: unknown;
  signoff?: string | null;
  maximumCharacters?: number;
}, includeDemoReplyCta: boolean): string {
  const maximumCharacters = Math.max(400, input.maximumCharacters || 4000);
  const source = normalised(input.body);
  const paragraphs = source
    .split(/\n\s*\n/)
    .map(cleanParagraph)
    .filter(Boolean);
  const content: string[] = [];
  let optOut = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length <= 260 && hasOutreachDemoReplyCta(paragraph)) {
      if (!includeDemoReplyCta) content.push(paragraph);
      continue;
    }
    if (paragraph.length <= 260 && SIMPLE_OPT_OUT.test(paragraph)) {
      if (!optOut) optOut = paragraph;
      continue;
    }
    content.push(paragraph);
  }

  let signature = "";
  const last = content.at(-1) || "";
  if (last && looksLikeSignature(last, input.signoff || undefined)) {
    signature = content.pop() || "";
  } else if (String(input.signoff || "").trim()) {
    signature = normalised(input.signoff);
  }

  const suffix = [
    optOut || OUTREACH_SIMPLE_OPT_OUT,
    includeDemoReplyCta ? OUTREACH_EMAIL_DEMO_REPLY_CTA : "",
    signature,
  ].filter(Boolean);
  const suffixText = suffix.join("\n\n");
  const separatorLength = content.length && suffixText ? 2 : 0;
  const contentLimit = Math.max(
    0,
    maximumCharacters - suffixText.length - separatorLength
  );
  const contentText = trimAtSentenceBoundary(
    content.join("\n\n"),
    contentLimit
  );

  return [contentText, suffixText].filter(Boolean).join("\n\n").trim();
}

/**
 * Cold outreach keeps a simple opt out immediately before the sender's
 * signature. A sales call to action is deliberately optional.
 */
export function ensureOutreachEmailSimpleOptOut(input: {
  body: unknown;
  signoff?: string | null;
  maximumCharacters?: number;
}): string {
  return formatOutreachEmailEnding(input, false);
}

/**
 * Add the standard reply to book call to action only when a campaign or sender
 * has explicitly selected it. Existing ending paragraphs are normalised so a
 * deliberate call to action is never duplicated.
 */
export function ensureOutreachEmailDemoReplyCta(input: {
  body: unknown;
  signoff?: string | null;
  maximumCharacters?: number;
}): string {
  return formatOutreachEmailEnding(input, true);
}

/** The CTA must be the final message paragraph, with only a signature after it. */
export function outreachEmailEndsWithDemoReplyCta(value: unknown): boolean {
  const paragraphs = normalised(value)
    .split(/\n\s*\n/)
    .map(cleanParagraph)
    .filter(Boolean);
  if (!paragraphs.length) return false;
  if (looksLikeSignature(paragraphs.at(-1) || "")) paragraphs.pop();
  return hasOutreachDemoReplyCta(paragraphs.at(-1) || "");
}

/**
 * The spoken pitch uses the collective "we" because a stock or shared voice
 * must never claim to be the salesperson whose mailbox sends the email.
 */
export function ensureOutreachVoiceDemoReplyCta(value: unknown): string {
  const script = normalised(value).replace(/\s+/g, " ");
  if (!script) return OUTREACH_VOICE_DEMO_REPLY_CTA;
  if (outreachVoiceEndsWithDemoReplyCta(script)) return script;
  return `${script} ${OUTREACH_VOICE_DEMO_REPLY_CTA}`.replace(/\s+/g, " ").trim();
}

export function outreachVoiceEndsWithDemoReplyCta(value: unknown): boolean {
  const script = normalised(value).replace(/\s+/g, " ");
  const sentences = script.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  return hasOutreachDemoReplyCta(sentences.at(-1) || "");
}
