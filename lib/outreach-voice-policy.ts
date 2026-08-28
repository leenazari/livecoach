export const OUTREACH_VOICE_MIN_WORDS = 105;
export const OUTREACH_VOICE_MAX_WORDS = 120;
export const OUTREACH_VOICE_MAX_CHARACTERS = 800;
export const OUTREACH_VOICE_MAX_COST_GBP = 0.05;

export function outreachVoiceWordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}
