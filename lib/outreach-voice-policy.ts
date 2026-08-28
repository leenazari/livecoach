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

export function outreachVoiceWordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateOutreachVoiceCostGbp(
  script: string,
  rateGbpPerThousandCharacters =
    OUTREACH_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS
): number {
  return Number(
    ((script.length / 1000) * rateGbpPerThousandCharacters).toFixed(6)
  );
}
