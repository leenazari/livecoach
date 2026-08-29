export const OUTREACH_SHARED_DEFAULT_VOICE_ID = "bDTlr4ICxntY9qVWyL0o";
export const OUTREACH_SHARED_DEFAULT_VOICE_NAME =
  "Sam Elliott – British Podcast Host";

export type EffectiveOutreachVoice = {
  voiceId: string;
  voiceName: string;
  source: "personal" | "shared_default";
};

const clean = (value: unknown, max: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function selectEffectiveOutreachVoice(
  profile?: {
    outreach_voice_id?: unknown;
    outreach_voice_name?: unknown;
  } | null
): EffectiveOutreachVoice {
  const personalVoiceId = clean(profile?.outreach_voice_id, 120);
  if (personalVoiceId) {
    return {
      voiceId: personalVoiceId,
      voiceName:
        clean(profile?.outreach_voice_name, 120) || "My sales outreach voice",
      source: "personal",
    };
  }

  return {
    voiceId: OUTREACH_SHARED_DEFAULT_VOICE_ID,
    voiceName: OUTREACH_SHARED_DEFAULT_VOICE_NAME,
    source: "shared_default",
  };
}
