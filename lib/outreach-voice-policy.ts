export const OUTREACH_VOICE_TARGET_WORDS = 100;
export const OUTREACH_VOICE_PREFERRED_MIN_WORDS = 80;
export const OUTREACH_VOICE_PREFERRED_MAX_WORDS = 120;

// Five pence is a commercial target, not a sentence-cutting rule. The larger
// limits are an emergency guard against an accidentally expensive generation.
export const OUTREACH_VOICE_TARGET_COST_GBP = 0.05;
export const OUTREACH_VOICE_HARD_MAX_COST_GBP = 0.075;
export const OUTREACH_VOICE_HARD_MAX_WORDS = 150;
export const OUTREACH_VOICE_HARD_MAX_CHARACTERS = 1200;

// ElevenLabs publishes Flash and Turbo at USD 0.05 per 1,000 characters. This
// GBP rate deliberately carries headroom for exchange movement, taxes, and
// voice-library multipliers so the estimate shown before generation is cautious.
export const OUTREACH_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS = 0.0625;

export const OUTREACH_VOICE_BRAND_DISPLAY_NAME = "Interviewa";
export const OUTREACH_VOICE_BRAND_SPOKEN_NAME = "Interviewer";

export function outreachVoiceOpening(recipientFirstName?: string | null): string {
  const firstName = String(recipientFirstName || "").trim() || "there";
  return `Hi ${firstName}, I hope you're doing well today!`;
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The editable script keeps the correct Interviewa brand spelling. Only the
 * provider text uses the natural English pronunciation "Interviewer".
 */
export function outreachVoiceSpeechText(script: string): string {
  return String(script || "").replace(
    /\bInterviewa\b/gi,
    OUTREACH_VOICE_BRAND_SPOKEN_NAME
  );
}

export function outreachVoiceHasFalseSenderIdentity(
  script: string,
  senderName: string
): boolean {
  const genericNamedClaim =
    /\b(?:I am|I[’']m|This is|My name is|My name[’']s)\s+[\p{L}][\p{L}'’.\-]*(?:\s+[\p{L}][\p{L}'’.\-]*){0,3}\s+(?:from|at|with)\s+Interviewa\b/iu;
  if (
    genericNamedClaim.test(script) ||
    /\b(?:I am|I[’']m|This is)\s+(?:from|at|with)\s+Interviewa\b/i.test(
      script
    )
  ) return true;
  const names = [senderName, senderName.trim().split(/\s+/)[0]]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (!names.length) return false;
  const senderPattern = names.join("|");
  return new RegExp(
    `\\b(?:I am|I[’']m|This is|My name is|My name[’']s)\\s+(?:${senderPattern})\\b`,
    "i"
  ).test(script);
}

/**
 * AI generated pitches get a consistent human opening while the shared or
 * stock voice never impersonates the salesperson whose mailbox sends it.
 */
export function prepareOutreachVoiceScriptForReview(input: {
  script: string;
  recipientFirstName?: string | null;
  senderName: string;
}): string {
  const firstName = String(input.recipientFirstName || "").trim() || "there";
  const names = [input.senderName, input.senderName.trim().split(/\s+/)[0]]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const senderPattern = names.join("|");
  let script = String(input.script || "").replace(/\s+/g, " ").trim();

  script = script.replace(
    /\b(?:I am|I[’']m|This is|My name is|My name[’']s)\s+[\p{L}][\p{L}'’.\-]*(?:\s+[\p{L}][\p{L}'’.\-]*){0,3}\s+(?:from|at|with)\s+Interviewa\b[^.!?]*(?:[.!?]|$)/giu,
    "We are Interviewa."
  );

  if (senderPattern) {
    script = script.replace(
      new RegExp(
        `\\b(?:I am|I[’']m|This is|My name is|My name[’']s)\\s+(?:${senderPattern})\\b[^.!?]*(?:[.!?]|$)`,
        "gi"
      ),
      `We are ${OUTREACH_VOICE_BRAND_DISPLAY_NAME}.`
    );
  }
  script = script.replace(
    /\b(?:I am|I[’']m|This is)\s+(?:from|at|with)\s+Interviewa\b[^.!?]*(?:[.!?]|$)/gi,
    "We are Interviewa."
  );

  const escapedFirstName = escapeRegExp(firstName);
  script = script.replace(
    new RegExp(`^(?:hi|hello|hey)\\s+${escapedFirstName}[,!.]?\\s*`, "i"),
    ""
  );
  script = script.replace(/^how are you(?: doing)?(?: today)?[?.!,]?\s*/i, "");
  script = script.replace(
    /^I hope you(?: are|'re|’re)(?: doing)? well(?: today)?[?.!,]?\s*/i,
    ""
  );

  return `${outreachVoiceOpening(firstName)} ${script}`
    .replace(/\s+/g, " ")
    .trim();
}

export function outreachVoiceWordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateOutreachVoiceCostGbp(
  script: string,
  rateGbpPerThousandCharacters =
    OUTREACH_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS
): number {
  return Number(
    ((outreachVoiceSpeechText(script).length / 1000) *
      rateGbpPerThousandCharacters).toFixed(6)
  );
}
