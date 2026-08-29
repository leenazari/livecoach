export const EMAIL_ASSISTANT_VOICE_TARGET_WORDS = 100;
export const EMAIL_ASSISTANT_VOICE_PREFERRED_MIN_WORDS = 80;
export const EMAIL_ASSISTANT_VOICE_PREFERRED_MAX_WORDS = 120;

// Email Assistant owns its policy independently from Outreach. The current
// limits deliberately preserve the same commercial guard while allowing either
// product to change later without altering the other one.
export const EMAIL_ASSISTANT_VOICE_TARGET_COST_GBP = 0.05;
export const EMAIL_ASSISTANT_VOICE_HARD_MAX_COST_GBP = 0.075;
export const EMAIL_ASSISTANT_VOICE_HARD_MAX_WORDS = 150;
export const EMAIL_ASSISTANT_VOICE_HARD_MAX_CHARACTERS = 1200;
export const EMAIL_ASSISTANT_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS =
  0.0625;

export function normaliseEmailAssistantVoiceScript(value: unknown): string {
  // Reject excessive scripts at validation time instead of slicing speech and
  // silently cutting off the final sentence.
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function emailAssistantVoiceWordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateEmailAssistantVoiceCostGbp(
  script: string,
  rateGbpPerThousandCharacters =
    EMAIL_ASSISTANT_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS
): number {
  return Number(
    ((script.length / 1000) * rateGbpPerThousandCharacters).toFixed(6)
  );
}

type EmailAssistantVoiceReadinessRecord = {
  voice_script?: string | null;
  voice_status?: string | null;
  voice_audio_path?: string | null;
  voice_public_token?: string | null;
  voice_script_hash?: string | null;
  voice_model_id?: string | null;
  voice_provider_voice_id?: string | null;
  voice_script_approved_at?: string | null;
  voice_script_approved_by?: string | null;
  voice_script_approved_hash?: string | null;
};

export function emailAssistantVoiceReadyForDisplayedScript(
  record: EmailAssistantVoiceReadinessRecord,
  displayedScript: unknown
): boolean {
  return (
    record.voice_status === "ready" &&
    normaliseEmailAssistantVoiceScript(displayedScript) ===
      normaliseEmailAssistantVoiceScript(record.voice_script) &&
    Boolean(record.voice_audio_path) &&
    Boolean(record.voice_public_token) &&
    Boolean(record.voice_script_hash) &&
    Boolean(record.voice_model_id) &&
    Boolean(record.voice_provider_voice_id) &&
    Boolean(record.voice_script_approved_at) &&
    Boolean(record.voice_script_approved_by) &&
    Boolean(record.voice_script_approved_hash)
  );
}
