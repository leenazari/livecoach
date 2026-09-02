export const OUTREACH_EMAIL_DEMO_REPLY_CTA =
  "If you would like to book a quick demo, just reply to this email and I will arrange it.";

export const OUTREACH_VOICE_DEMO_REPLY_CTA =
  "If you would like to book a quick demo, just reply to this email and we will arrange it.";

export const OUTREACH_SIMPLE_OPT_OUT =
  "If this is not relevant, tell me and I will not follow up.";

const DEMO_REPLY_CTA =
  /\bbook(?:ing)?\s+(?:a\s+)?(?:(?:quick|(?:\d{1,2}|five|ten|fifteen|twenty)[\s-]*(?:minute|minutes|min|mins))\s+)?demo(?:nstration)?\b[\s\S]{0,180}\brepl(?:y|ying)\s+to\s+this\s+email\b|\brepl(?:y|ying)\s+to\s+this\s+email\b[\s\S]{0,180}\bbook(?:ing)?\s+(?:a\s+)?(?:(?:quick|(?:\d{1,2}|five|ten|fifteen|twenty)[\s-]*(?:minute|minutes|min|mins))\s+)?demo(?:nstration)?\b/i;
const GENERAL_SALES_CTA =
  /\b(?:reply|email|message|get in touch|come back to (?:me|us)|let (?:me|us) know)\b[\s\S]{0,120}\b(?:(?:quick|(?:\d{1,2}|five|ten|fifteen|twenty)[\s-]*(?:minute|minutes|min|mins))\s+)?(?:call|demo(?:nstration)?|chat|conversation)\b|\b(?:book|arrange|schedule|set up|have|open to)\b[\s\S]{0,100}\b(?:(?:quick|(?:\d{1,2}|five|ten|fifteen|twenty)[\s-]*(?:minute|minutes|min|mins))\s+)?(?:call|demo(?:nstration)?|chat|conversation)\b|\b(?:(?:quick|(?:\d{1,2}|five|ten|fifteen|twenty)[\s-]*(?:minute|minutes|min|mins))\s+)?(?:call|demo(?:nstration)?|chat|conversation)\b[\s\S]{0,100}\b(?:reply|email|message|get in touch|book|arrange|schedule|interested)\b/i;
const CAMPAIGN_CTA_OMISSION =
  /\b(?:no|without|omit|skip|avoid|exclude|do not|don[’']t|never)\b[\s\S]{0,55}\b(?:call to action|cta|invitation|demo(?:nstration)?|call|chat|conversation)\b/i;
const CAMPAIGN_CTA_ACTION =
  /\b(?:call to action|cta|book|booking|arrange|schedule|set up|invite|invitation|ask|reply|respond|get in touch|contact|offer)\b/i;
const CAMPAIGN_CTA_TARGET = /\b(demo(?:nstration)?|call|chat|conversation)\b/i;
const CAMPAIGN_CTA_DURATION =
  /\b(\d{1,2}|five|ten|fifteen|twenty)[\s-]*(?:minute|minutes|min|mins)\b/i;
const SIMPLE_OPT_OUT = /(not|won't|will not|do not).{0,24}follow up/i;
const COMMON_SIGN_OFF =
  /^(?:best|thanks|thank you|best regards|kind regards|regards|best wishes|cheers)[,!]?$/i;
const COMMON_SIGN_OFF_WITH_NAME =
  /^(?:best|thanks|thank you|best regards|kind regards|regards|best wishes|cheers)[,!]\s+[\p{L}'’.]+(?:\s+[\p{L}'’.]+){0,3}[.!]?$/iu;
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

export type OutreachCampaignCtaPolicy = {
  kind: "demo" | "call";
  durationMinutes: number | null;
  label: string;
  emailText: string;
  voiceText: string;
  source:
    | "sender_guidance"
    | "sequence_guidance"
    | "sequence_purpose"
    | "campaign_goal"
    | "campaign_offer";
};

type OutreachCampaignCtaInput = {
  campaignGoal?: unknown;
  campaignOfferAngle?: unknown;
  sequencePurpose?: unknown;
  sequenceGuidance?: unknown;
  senderGuidance?: unknown;
};

const CAMPAIGN_CTA_NUMBER_WORDS: Record<string, number> = {
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
};

function campaignCtaDuration(value: string): number | null {
  const match = value.match(CAMPAIGN_CTA_DURATION);
  if (!match) return null;
  const raw = match[1].toLocaleLowerCase("en-GB");
  const minutes = Number(raw) || CAMPAIGN_CTA_NUMBER_WORDS[raw] || 0;
  return minutes >= 1 && minutes <= 60 ? minutes : null;
}

function explicitCampaignCta(value: string, source: OutreachCampaignCtaPolicy["source"]): boolean {
  const targetText = value.replace(/\bcall to action\b|\bcta\b/gi, " ");
  if (!CAMPAIGN_CTA_TARGET.test(targetText) || CAMPAIGN_CTA_OMISSION.test(value)) {
    return false;
  }
  if (CAMPAIGN_CTA_ACTION.test(value) || CAMPAIGN_CTA_DURATION.test(value)) {
    return true;
  }
  return source === "campaign_goal";
}

/**
 * Convert a campaign's approved wording into one deterministic next step.
 * A sender or sequence can explicitly opt out. Otherwise campaigns that name a
 * demo or call as their goal do not rely on the model remembering that detail.
 */
export function resolveOutreachCampaignCta(
  input: OutreachCampaignCtaInput
): OutreachCampaignCtaPolicy | null {
  const senderGuidance = normalised(input.senderGuidance);
  const sequenceGuidance = normalised(input.sequenceGuidance);
  if (
    (senderGuidance && CAMPAIGN_CTA_OMISSION.test(senderGuidance)) ||
    (sequenceGuidance && CAMPAIGN_CTA_OMISSION.test(sequenceGuidance))
  ) {
    return null;
  }

  const candidates: Array<{
    source: OutreachCampaignCtaPolicy["source"];
    value: string;
  }> = [
    { source: "sender_guidance", value: senderGuidance },
    { source: "sequence_guidance", value: sequenceGuidance },
    { source: "sequence_purpose", value: normalised(input.sequencePurpose) },
    { source: "campaign_goal", value: normalised(input.campaignGoal) },
    { source: "campaign_offer", value: normalised(input.campaignOfferAngle) },
  ];
  const selected = candidates.find((candidate) =>
    explicitCampaignCta(candidate.value, candidate.source)
  );
  if (!selected) return null;

  const kind: OutreachCampaignCtaPolicy["kind"] = /\bdemo(?:nstration)?\b/i.test(
    selected.value
  )
    ? "demo"
    : "call";
  const durationMinutes = campaignCtaDuration(selected.value);
  const label = durationMinutes
    ? `${durationMinutes} minute ${kind}`
    : `quick ${kind}`;
  return {
    kind,
    durationMinutes,
    label,
    emailText: `Would you be open to booking a ${label}? Just reply to this email and I will arrange it.`,
    voiceText: `Would you be open to booking a ${label}? Just reply to this email and we will arrange it.`,
    source: selected.source,
  };
}

export function hasOutreachCampaignCta(
  value: unknown,
  policy: OutreachCampaignCtaPolicy | null
): boolean {
  if (!policy) return hasOutreachSalesCallToAction(value);
  const source = normalised(value).slice(-700);
  if (!hasOutreachSalesCallToAction(source)) return false;
  const target = policy.kind === "demo"
    ? /\bdemo(?:nstration)?\b/i
    : /\b(?:call|chat|conversation)\b/i;
  if (!target.test(source)) return false;
  if (!policy.durationMinutes) return true;
  const duration = new RegExp(
    `\\b(?:${policy.durationMinutes}|${Object.entries(CAMPAIGN_CTA_NUMBER_WORDS)
      .find(([, minutes]) => minutes === policy.durationMinutes)?.[0] || policy.durationMinutes})[\\s-]*(?:minute|minutes|min|mins)\\b`,
    "i"
  );
  return duration.test(source);
}

export function hasOutreachDemoReplyCta(value: unknown): boolean {
  return DEMO_REPLY_CTA.test(normalised(value));
}

/**
 * Detect a useful low pressure next step without requiring the one standard
 * phrase. This powers optional UI guidance only. It is never a send guard.
 */
export function hasOutreachSalesCallToAction(value: unknown): boolean {
  const source = normalised(value);
  if (!source) return false;
  const trailingCopy = source.slice(-700);
  return hasOutreachDemoReplyCta(trailingCopy) || GENERAL_SALES_CTA.test(trailingCopy);
}

function looksLikeSignature(paragraph: string, signoff?: string): boolean {
  const compact = comparable(paragraph);
  const exactSignoff = comparable(signoff);
  if (exactSignoff && compact === exactSignoff && paragraph.length <= 220) {
    return true;
  }
  if (COMMON_SIGN_OFF_WITH_NAME.test(paragraph.trim()) && paragraph.length <= 160) {
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

function looksLikeSignatureFragment(paragraph: string, signoff?: string): boolean {
  if (looksLikeSignature(paragraph, signoff)) return true;
  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length === 1 && COMMON_SIGN_OFF.test(lines[0]);
}

function normaliseOutreachEmailSignoff(value: unknown): string {
  const source = normalised(value);
  if (!source) return "";
  const uniqueLines: string[] = [];
  for (const line of source.split("\n").map((item) => item.trim()).filter(Boolean)) {
    if (comparable(uniqueLines.at(-1)) === comparable(line)) continue;
    uniqueLines.push(line);
  }
  return uniqueLines
    .join("\n")
    .replace(
      /^((?:best wishes|best regards|kind regards|regards|best|thanks|thank you|cheers)[,!]?)(?:\s+\1)+/i,
      "$1"
    )
    .trim();
}

function splitTrailingSignature(
  paragraph: string,
  signoff?: string
): { content: string; signature: string } {
  const lines = paragraph
    .split("\n")
    .map((line) => line.trimEnd());
  for (let index = 0; index < lines.length; index += 1) {
    const signature = lines.slice(index).join("\n").trim();
    if (!looksLikeSignatureFragment(signature, signoff)) continue;
    return {
      content: lines.slice(0, index).join("\n").trim(),
      signature,
    };
  }
  return { content: paragraph.trim(), signature: "" };
}

function extractTrailingSignature(value: unknown, signoff?: string | null) {
  const configured = normaliseOutreachEmailSignoff(signoff);
  const paragraphs = normalised(value)
    .split(/\n\s*\n/)
    .map(cleanParagraph)
    .filter(Boolean);
  if (!paragraphs.length) return { content: "", signature: configured };

  const lastIndex = paragraphs.length - 1;
  const last = splitTrailingSignature(
    paragraphs[lastIndex],
    configured || undefined
  );
  if (!last.signature) {
    return {
      content: paragraphs.join("\n\n").trim(),
      signature: configured,
    };
  }

  let inferred = normaliseOutreachEmailSignoff(last.signature);
  if (last.content) paragraphs[lastIndex] = last.content;
  else paragraphs.pop();

  // Remove only repeats of the signature already found. Do not keep walking
  // backwards through arbitrary one line paragraphs, because a normal final
  // sentence such as "Hello" can also resemble a person's first name.
  while (paragraphs.length) {
    const candidateIndex = paragraphs.length - 1;
    const candidate = splitTrailingSignature(
      paragraphs[candidateIndex],
      configured || inferred || undefined
    );
    if (!candidate.signature) break;
    const sameSignature =
      comparable(candidate.signature) === comparable(inferred) ||
      (configured && comparable(candidate.signature) === comparable(configured));
    const precedingSignOffForName =
      !candidate.content &&
      PERSON_NAME.test(inferred) &&
      COMMON_SIGN_OFF.test(candidate.signature);
    if (!sameSignature && !precedingSignOffForName) break;
    if (precedingSignOffForName) {
      inferred = `${candidate.signature}\n${inferred}`;
    }
    if (candidate.content) {
      paragraphs[candidateIndex] = candidate.content;
      break;
    }
    paragraphs.pop();
  }

  return {
    content: paragraphs.join("\n\n").trim(),
    signature: configured || normaliseOutreachEmailSignoff(inferred),
  };
}

/**
 * Keep one canonical signature at the end of an email. This also repairs the
 * common model output where an opt out and the first signature share one
 * paragraph before the same signature is added again.
 */
export function deduplicateOutreachEmailSignoff(input: {
  body: unknown;
  signoff?: string | null;
}): string {
  const ending = extractTrailingSignature(input.body, input.signoff);
  return [ending.content, ending.signature]
    .filter(Boolean)
    .join("\n\n")
    .trim();
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
}, ctaText: string | null, replaceAnySalesCta = false): string {
  const maximumCharacters = Math.max(400, input.maximumCharacters || 4000);
  const ending = extractTrailingSignature(input.body, input.signoff);
  const paragraphs = ending.content
    .split(/\n\s*\n/)
    .map(cleanParagraph)
    .filter(Boolean);
  const content: string[] = [];
  let optOut = "";

  for (const paragraph of paragraphs) {
    if (
      ctaText &&
      paragraph.length <= 320 &&
      (replaceAnySalesCta
        ? hasOutreachSalesCallToAction(paragraph)
        : hasOutreachDemoReplyCta(paragraph))
    ) {
      continue;
    }
    if (paragraph.length <= 260 && SIMPLE_OPT_OUT.test(paragraph)) {
      if (!optOut) optOut = paragraph;
      continue;
    }
    content.push(paragraph);
  }

  let signature = ending.signature;
  while (content.length) {
    const lastIndex = content.length - 1;
    const split = splitTrailingSignature(
      content[lastIndex],
      signature || input.signoff || undefined
    );
    if (!split.signature) break;
    signature =
      normaliseOutreachEmailSignoff(input.signoff) ||
      normaliseOutreachEmailSignoff(split.signature) ||
      signature;
    if (split.content) {
      content[lastIndex] = split.content;
      break;
    }
    content.pop();
  }

  const suffix = [
    optOut || OUTREACH_SIMPLE_OPT_OUT,
    ctaText || "",
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
  return formatOutreachEmailEnding(input, null);
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
  return formatOutreachEmailEnding(input, OUTREACH_EMAIL_DEMO_REPLY_CTA);
}

/**
 * Apply an explicitly configured campaign CTA once while keeping ordinary
 * campaigns advisory only. A short model generated CTA is replaced so the
 * recipient never sees two competing next steps.
 */
export function ensureOutreachEmailCampaignCta(input: {
  body: unknown;
  policy: OutreachCampaignCtaPolicy;
  signoff?: string | null;
  maximumCharacters?: number;
}): string {
  return formatOutreachEmailEnding(input, input.policy.emailText, true);
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

export function ensureOutreachVoiceCampaignCta(input: {
  script: unknown;
  policy: OutreachCampaignCtaPolicy;
}): string {
  const script = normalised(input.script).replace(/\s+/g, " ");
  if (!script) return input.policy.voiceText;
  if (hasOutreachCampaignCta(script, input.policy)) return script;
  const sentences = script.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  if (
    sentences.length &&
    hasOutreachSalesCallToAction(sentences.at(-1) || "")
  ) {
    sentences.pop();
  }
  return `${sentences.join(" ").trim()} ${input.policy.voiceText}`
    .replace(/\s+/g, " ")
    .trim();
}

export function outreachVoiceEndsWithDemoReplyCta(value: unknown): boolean {
  const script = normalised(value).replace(/\s+/g, " ");
  const sentences = script.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  return hasOutreachDemoReplyCta(sentences.at(-1) || "");
}
