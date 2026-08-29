import "server-only";

import { publicAppOrigin } from "@/lib/public-app-url";
import {
  EMAIL_ASSISTANT_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS,
  EMAIL_ASSISTANT_VOICE_HARD_MAX_CHARACTERS,
  EMAIL_ASSISTANT_VOICE_HARD_MAX_COST_GBP,
  EMAIL_ASSISTANT_VOICE_HARD_MAX_WORDS,
  EMAIL_ASSISTANT_VOICE_PREFERRED_MAX_WORDS,
  EMAIL_ASSISTANT_VOICE_PREFERRED_MIN_WORDS,
  EMAIL_ASSISTANT_VOICE_TARGET_COST_GBP,
  emailAssistantVoiceWordCount,
  estimateEmailAssistantVoiceCostGbp,
  normaliseEmailAssistantVoiceScript,
} from "@/lib/email-assistant-voice-policy";
import {
  approvedVoiceScriptHash,
  generateElevenLabsVoiceAudio,
  VOICE_NOTE_BUCKET,
  VOICE_NOTE_MIME,
  voiceScriptHash,
  type VoiceProviderConfig,
} from "@/lib/voice-note-provider";

export const EMAIL_ASSISTANT_VOICE_BUCKET = VOICE_NOTE_BUCKET;
export const EMAIL_ASSISTANT_VOICE_MIME = VOICE_NOTE_MIME;

export type EmailAssistantVoiceBudget = {
  characters: number;
  words: number;
  rateGbpPerThousandCharacters: number;
  estimatedCostGbp: number;
  targetCostGbp: number;
  maximumCostGbp: number;
  withinPreferredWordRange: boolean;
  overTargetCost: boolean;
};

export class EmailAssistantVoiceBudgetError extends Error {
  status = 422;
}

export function emailAssistantEstimatedVoiceSeconds(script: string): number {
  const wordCount = emailAssistantVoiceWordCount(script);
  return Math.max(20, Math.min(90, Math.round((wordCount / 135) * 60)));
}

export function emailAssistantVoiceScriptHash(
  script: string,
  voiceId: string,
  modelId: string
): string {
  return voiceScriptHash(script, voiceId, modelId);
}

export function emailAssistantVoiceApprovalHash(script: string): string {
  return approvedVoiceScriptHash(
    normaliseEmailAssistantVoiceScript(script)
  );
}

export function emailAssistantVoiceStoragePath(input: {
  workspaceId: string;
  ownerId: string;
  draftId: string;
  scriptHash: string;
}): string {
  return [
    input.workspaceId,
    input.ownerId,
    "email-assistant",
    input.draftId,
    `${input.scriptHash}.mp3`,
  ].join("/");
}

export function emailAssistantVoicePublicUrl(token: string): string {
  return `${publicAppOrigin()}/listen/next-move/${encodeURIComponent(token)}`;
}

function conservativeEmailAssistantModelRateGbp(modelId: string): number {
  return /(flash|turbo)/i.test(modelId)
    ? EMAIL_ASSISTANT_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS
    : EMAIL_ASSISTANT_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS * 2;
}

export function emailAssistantVoiceRateGbpPerThousand(
  modelId: string
): number {
  const configured = Number(
    process.env.ELEVENLABS_COST_GBP_PER_1000_CHARS || 0
  );
  const conservativeFloor = conservativeEmailAssistantModelRateGbp(modelId);
  return Number.isFinite(configured) && configured > conservativeFloor
    ? configured
    : conservativeFloor;
}

export function emailAssistantVoiceBudget(
  script: string,
  modelId: string
): EmailAssistantVoiceBudget {
  const characters = script.length;
  const words = emailAssistantVoiceWordCount(script);
  const rateGbpPerThousandCharacters =
    emailAssistantVoiceRateGbpPerThousand(modelId);
  const estimatedCostGbp = estimateEmailAssistantVoiceCostGbp(
    script,
    rateGbpPerThousandCharacters
  );
  return {
    characters,
    words,
    rateGbpPerThousandCharacters,
    estimatedCostGbp,
    targetCostGbp: EMAIL_ASSISTANT_VOICE_TARGET_COST_GBP,
    maximumCostGbp: EMAIL_ASSISTANT_VOICE_HARD_MAX_COST_GBP,
    withinPreferredWordRange:
      words >= EMAIL_ASSISTANT_VOICE_PREFERRED_MIN_WORDS &&
      words <= EMAIL_ASSISTANT_VOICE_PREFERRED_MAX_WORDS,
    overTargetCost:
      estimatedCostGbp > EMAIL_ASSISTANT_VOICE_TARGET_COST_GBP,
  };
}

export function assertEmailAssistantVoiceWithinBudget(
  script: string,
  modelId: string
): EmailAssistantVoiceBudget {
  const budget = emailAssistantVoiceBudget(script, modelId);
  if (budget.words > EMAIL_ASSISTANT_VOICE_HARD_MAX_WORDS) {
    throw new EmailAssistantVoiceBudgetError(
      `This voice reply is beyond the safety limit. Shorten it to ${EMAIL_ASSISTANT_VOICE_HARD_MAX_WORDS} words or fewer while keeping the final sentence complete`
    );
  }
  if (budget.characters > EMAIL_ASSISTANT_VOICE_HARD_MAX_CHARACTERS) {
    throw new EmailAssistantVoiceBudgetError(
      `This voice reply is beyond the safety limit. Shorten it to ${EMAIL_ASSISTANT_VOICE_HARD_MAX_CHARACTERS} characters or fewer while keeping the final sentence complete`
    );
  }
  if (budget.estimatedCostGbp > EMAIL_ASSISTANT_VOICE_HARD_MAX_COST_GBP) {
    throw new EmailAssistantVoiceBudgetError(
      `This voice reply is estimated above the ${(EMAIL_ASSISTANT_VOICE_HARD_MAX_COST_GBP * 100).toFixed(1)} pence safety limit. Shorten it without cutting the final sentence, or use the Flash voice model`
    );
  }
  return budget;
}

export async function generateElevenLabsEmailAssistantAudio(input: {
  script: string;
  config: VoiceProviderConfig;
}): Promise<{
  audio: Buffer;
  requestId: string | null;
  characters: number;
}> {
  const script = normaliseEmailAssistantVoiceScript(input.script);
  assertEmailAssistantVoiceWithinBudget(script, input.config.modelId);
  return generateElevenLabsVoiceAudio({
    script,
    config: input.config,
    // Reply notes should sound conversational and restrained. Outreach owns a
    // different setting profile and can evolve without changing these values.
    settings: {
      stability: 0.52,
      similarity_boost: 0.84,
      style: 0.1,
      use_speaker_boost: true,
    },
  });
}

export function configuredEmailAssistantVoiceCostGbp(
  characters: number,
  modelId = "eleven_flash_v2_5"
): number {
  return Number(
    (
      (characters / 1000) *
      emailAssistantVoiceRateGbpPerThousand(modelId)
    ).toFixed(6)
  );
}

export function emailAssistantVoiceMatchesCurrentConfig(
  draft: {
    owner_id: string;
    voice_script: string | null;
    voice_status: string;
    voice_audio_path: string | null;
    voice_public_token: string;
    voice_script_hash: string | null;
    voice_model_id: string | null;
    voice_provider_voice_id: string | null;
    voice_script_approved_at: string | null;
    voice_script_approved_by: string | null;
    voice_script_approved_hash: string | null;
  },
  config: VoiceProviderConfig
): boolean {
  const script = normaliseEmailAssistantVoiceScript(draft.voice_script);
  if (!script) return false;
  return (
    draft.voice_status === "ready" &&
    Boolean(draft.voice_audio_path) &&
    Boolean(draft.voice_public_token) &&
    draft.voice_script_hash ===
      emailAssistantVoiceScriptHash(script, config.voiceId, config.modelId) &&
    draft.voice_model_id === config.modelId &&
    draft.voice_provider_voice_id === config.voiceId &&
    Boolean(draft.voice_script_approved_at) &&
    draft.voice_script_approved_by === draft.owner_id &&
    draft.voice_script_approved_hash ===
      emailAssistantVoiceApprovalHash(script)
  );
}
