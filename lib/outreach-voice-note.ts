import "server-only";

import { publicAppOrigin } from "@/lib/public-app-url";
import { supabaseService } from "@/lib/supabase";
import type { OutreachIdentity } from "@/lib/outreach-identity";
import { selectEffectiveOutreachVoice } from "@/lib/outreach-voice-default";
import {
  estimateOutreachVoiceCostGbp,
  OUTREACH_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS,
  OUTREACH_VOICE_HARD_MAX_CHARACTERS,
  OUTREACH_VOICE_HARD_MAX_COST_GBP,
  OUTREACH_VOICE_HARD_MAX_WORDS,
  OUTREACH_VOICE_PREFERRED_MAX_WORDS,
  OUTREACH_VOICE_PREFERRED_MIN_WORDS,
  OUTREACH_VOICE_TARGET_COST_GBP,
  outreachVoiceSpeechText,
  outreachVoiceWordCount,
} from "@/lib/outreach-voice-policy";
import {
  approvedVoiceScriptHash,
  generateElevenLabsVoiceAudio,
  VOICE_NOTE_BUCKET,
  VOICE_NOTE_MIME,
  voiceScriptHash,
} from "@/lib/voice-note-provider";

export const OUTREACH_VOICE_BUCKET = VOICE_NOTE_BUCKET;
export const OUTREACH_VOICE_MIME = VOICE_NOTE_MIME;

export type OutreachVoiceConfig = {
  voiceId: string;
  voiceName: string;
  modelId: string;
  source: "personal" | "shared_default";
};

export type OutreachVoiceBudget = {
  characters: number;
  words: number;
  rateGbpPerThousandCharacters: number;
  estimatedCostGbp: number;
  targetCostGbp: number;
  maximumCostGbp: number;
  withinPreferredWordRange: boolean;
  overTargetCost: boolean;
};

export class OutreachVoiceBudgetError extends Error {
  status = 422;
}

const clean = (value: unknown, max: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

function safeOutreachVoiceModel(value: unknown): string {
  const requested = clean(value, 120);
  return /^eleven_(flash|turbo)_/i.test(requested)
    ? requested
    : "eleven_flash_v2_5";
}

export function normaliseOutreachVoiceScript(value: unknown): string {
  // Never slice a spoken script. Any genuinely excessive draft is rejected by
  // the safety guard so a sentence can never be cut off silently.
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function estimatedVoiceSeconds(script: string): number {
  const wordCount = outreachVoiceWordCount(script);
  return Math.max(20, Math.min(90, Math.round((wordCount / 135) * 60)));
}

export function outreachVoiceScriptHash(
  script: string,
  voiceId: string,
  modelId: string
): string {
  return voiceScriptHash(outreachVoiceSpeechText(script), voiceId, modelId);
}

export function outreachVoiceApprovalHash(script: string): string {
  return approvedVoiceScriptHash(normaliseOutreachVoiceScript(script));
}

export function outreachVoiceStoragePath(input: {
  workspaceId: string;
  senderUserId: string;
  messageId: string;
  scriptHash: string;
}): string {
  return [
    input.workspaceId,
    input.senderUserId,
    input.messageId,
    `${input.scriptHash}.mp3`,
  ].join("/");
}

export function outreachVoicePublicUrl(token: string): string {
  return `${publicAppOrigin()}/listen/${encodeURIComponent(token)}`;
}

export async function resolveOutreachVoiceConfig(
  sender: Pick<OutreachIdentity, "userId" | "workspaceId">
): Promise<OutreachVoiceConfig> {
  const { data: profile, error: profileError } = await supabaseService
    .from("salesperson_profiles")
    .select("outreach_voice_id,outreach_voice_name")
    .eq("workspace_id", sender.workspaceId)
    .eq("user_id", sender.userId)
    .maybeSingle();
  if (profileError) throw profileError;

  // Outreach has its own shared product default. A salesperson's exact scoped
  // selection overrides it. Brain and Email Assistant voices are never used as
  // fallbacks, including for the workspace owner.
  const selectedVoice = selectEffectiveOutreachVoice(profile);
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs is not configured for this LiveCoach deployment");
  }
  return {
    voiceId: selectedVoice.voiceId,
    voiceName: selectedVoice.voiceName,
    modelId: safeOutreachVoiceModel(
      process.env.ELEVENLABS_OUTREACH_MODEL_ID
    ),
    source: selectedVoice.source,
  };
}

export async function generateElevenLabsOutreachAudio(input: {
  script: string;
  config: OutreachVoiceConfig;
}): Promise<{
  audio: Buffer;
  requestId: string | null;
  characters: number;
}> {
  const approvedScript = normaliseOutreachVoiceScript(input.script);
  const script = outreachVoiceSpeechText(approvedScript);
  const budget = assertOutreachVoiceWithinBudget(
    approvedScript,
    input.config.modelId
  );
  const generated = await generateElevenLabsVoiceAudio({
    script,
    config: input.config,
    settings: {
      stability: 0.58,
      similarity_boost: 0.82,
      style: 0.18,
      use_speaker_boost: true,
    },
  });
  return { ...generated, characters: budget.characters };
}

function conservativeModelRateGbp(modelId: string): number {
  // ElevenLabs currently prices Flash and Turbo at half the standard TTS
  // character rate. These GBP floors deliberately include headroom above the
  // published USD amount so the five pence limit fails closed rather than
  // relying on a favourable exchange rate.
  return /(flash|turbo)/i.test(modelId)
    ? OUTREACH_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS
    : OUTREACH_VOICE_DEFAULT_RATE_GBP_PER_1000_CHARACTERS * 2;
}

export function outreachVoiceRateGbpPerThousand(modelId: string): number {
  const configured = Number(
    process.env.ELEVENLABS_COST_GBP_PER_1000_CHARS || 0
  );
  const conservativeFloor = conservativeModelRateGbp(modelId);
  return Number.isFinite(configured) && configured > conservativeFloor
    ? configured
    : conservativeFloor;
}

export function outreachVoiceBudget(
  script: string,
  modelId: string
): OutreachVoiceBudget {
  const characters = outreachVoiceSpeechText(script).length;
  const words = outreachVoiceWordCount(script);
  const rateGbpPerThousandCharacters =
    outreachVoiceRateGbpPerThousand(modelId);
  return {
    characters,
    words,
    rateGbpPerThousandCharacters,
    estimatedCostGbp: estimateOutreachVoiceCostGbp(
      script,
      rateGbpPerThousandCharacters
    ),
    targetCostGbp: OUTREACH_VOICE_TARGET_COST_GBP,
    maximumCostGbp: OUTREACH_VOICE_HARD_MAX_COST_GBP,
    withinPreferredWordRange:
      words >= OUTREACH_VOICE_PREFERRED_MIN_WORDS &&
      words <= OUTREACH_VOICE_PREFERRED_MAX_WORDS,
    overTargetCost:
      estimateOutreachVoiceCostGbp(
        script,
        rateGbpPerThousandCharacters
      ) > OUTREACH_VOICE_TARGET_COST_GBP,
  };
}

export function assertOutreachVoiceWithinBudget(
  script: string,
  modelId: string
): OutreachVoiceBudget {
  const budget = outreachVoiceBudget(script, modelId);
  if (budget.words > OUTREACH_VOICE_HARD_MAX_WORDS) {
    throw new OutreachVoiceBudgetError(
      `This voice pitch is beyond the safety limit. Shorten it to ${OUTREACH_VOICE_HARD_MAX_WORDS} words or fewer while keeping the final sentence complete`
    );
  }
  if (budget.characters > OUTREACH_VOICE_HARD_MAX_CHARACTERS) {
    throw new OutreachVoiceBudgetError(
      `This voice pitch is beyond the safety limit. Shorten it to ${OUTREACH_VOICE_HARD_MAX_CHARACTERS} characters or fewer while keeping the final sentence complete`
    );
  }
  if (budget.estimatedCostGbp > OUTREACH_VOICE_HARD_MAX_COST_GBP) {
    throw new OutreachVoiceBudgetError(
      `This voice pitch is estimated above the ${(OUTREACH_VOICE_HARD_MAX_COST_GBP * 100).toFixed(1)} pence safety limit. Shorten it without cutting the final sentence, or use the Flash voice model`
    );
  }
  return budget;
}

export function configuredVoiceNoteCostGbp(
  characters: number,
  modelId = "eleven_flash_v2_5"
): number {
  return Number(
    ((characters / 1000) * outreachVoiceRateGbpPerThousand(modelId)).toFixed(6)
  );
}
