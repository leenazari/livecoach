import "server-only";

import { createHash } from "crypto";
import { publicAppOrigin } from "@/lib/public-app-url";
import { supabaseService } from "@/lib/supabase";
import type { OutreachIdentity } from "@/lib/outreach-identity";
import {
  OUTREACH_VOICE_MAX_CHARACTERS,
  OUTREACH_VOICE_MAX_COST_GBP,
  OUTREACH_VOICE_MAX_WORDS,
  OUTREACH_VOICE_MIN_WORDS,
  outreachVoiceWordCount,
} from "@/lib/outreach-voice-policy";

export const OUTREACH_VOICE_BUCKET = "outreach-voice-notes";
export const OUTREACH_VOICE_MIME = "audio/mpeg";

export type OutreachVoiceConfig = {
  voiceId: string;
  voiceName: string;
  modelId: string;
  usingOwnerDefault: boolean;
};

export type OutreachVoiceBudget = {
  characters: number;
  words: number;
  rateGbpPerThousandCharacters: number;
  estimatedCostGbp: number;
  maximumCostGbp: number;
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
  return clean(value, 1800)
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
  return createHash("sha256")
    .update(`${voiceId}\n${modelId}\n${script}`)
    .digest("hex");
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
  sender: OutreachIdentity
): Promise<OutreachVoiceConfig> {
  const [{ data: profile, error: profileError }, { data: member, error: memberError }] =
    await Promise.all([
      supabaseService
        .from("salesperson_profiles")
        .select("outreach_voice_id,outreach_voice_name")
        .eq("workspace_id", sender.workspaceId)
        .eq("user_id", sender.userId)
        .maybeSingle(),
      supabaseService
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", sender.workspaceId)
        .eq("user_id", sender.userId)
        .eq("status", "active")
        .maybeSingle(),
    ]);
  if (profileError) throw profileError;
  if (memberError) throw memberError;

  const personalVoiceId = clean(profile?.outreach_voice_id, 120);
  const ownerDefaultVoiceId = member?.role === "owner"
    ? clean(process.env.ELEVENLABS_VOICE_ID, 120)
    : "";
  const voiceId = personalVoiceId || ownerDefaultVoiceId;
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs is not configured for this LiveCoach deployment");
  }
  if (!voiceId) {
    throw new Error(
      "Add your own ElevenLabs voice ID in My Sales Setup before creating a personal voice note"
    );
  }
  return {
    voiceId,
    voiceName: clean(profile?.outreach_voice_name, 120) ||
      (personalVoiceId ? "My outreach voice" : "LiveCoach owner voice"),
    modelId: safeOutreachVoiceModel(
      process.env.ELEVENLABS_OUTREACH_MODEL_ID
    ),
    usingOwnerDefault: !personalVoiceId && Boolean(ownerDefaultVoiceId),
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
  const script = normaliseOutreachVoiceScript(input.script);
  const budget = assertOutreachVoiceWithinBudget(script, input.config.modelId);
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.config.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
        "Content-Type": "application/json",
        Accept: OUTREACH_VOICE_MIME,
      },
      body: JSON.stringify({
        text: script,
        model_id: input.config.modelId,
        voice_settings: {
          stability: 0.58,
          similarity_boost: 0.82,
          style: 0.18,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    }
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 240);
    throw new Error(
      response.status === 401
        ? "ElevenLabs rejected the configured account or voice"
        : `ElevenLabs could not create this voice note (${response.status})${detail ? `, ${detail}` : ""}`
    );
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1000) throw new Error("ElevenLabs returned an empty voice note");
  return {
    audio,
    requestId:
      response.headers.get("request-id") ||
      response.headers.get("x-request-id"),
    characters: budget.characters,
  };
}

function conservativeModelRateGbp(modelId: string): number {
  // ElevenLabs currently prices Flash and Turbo at half the standard TTS
  // character rate. These GBP floors deliberately include headroom above the
  // published USD amount so the five pence limit fails closed rather than
  // relying on a favourable exchange rate.
  return /(flash|turbo)/i.test(modelId) ? 0.0625 : 0.125;
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
  const characters = script.length;
  const words = outreachVoiceWordCount(script);
  const rateGbpPerThousandCharacters =
    outreachVoiceRateGbpPerThousand(modelId);
  return {
    characters,
    words,
    rateGbpPerThousandCharacters,
    estimatedCostGbp: Number(
      ((characters / 1000) * rateGbpPerThousandCharacters).toFixed(6)
    ),
    maximumCostGbp: OUTREACH_VOICE_MAX_COST_GBP,
  };
}

export function assertOutreachVoiceWithinBudget(
  script: string,
  modelId: string
): OutreachVoiceBudget {
  const budget = outreachVoiceBudget(script, modelId);
  if (budget.words < OUTREACH_VOICE_MIN_WORDS) {
    throw new OutreachVoiceBudgetError(
      `The voice pitch is too short. Use ${OUTREACH_VOICE_MIN_WORDS} to ${OUTREACH_VOICE_MAX_WORDS} words`
    );
  }
  if (budget.words > OUTREACH_VOICE_MAX_WORDS) {
    throw new OutreachVoiceBudgetError(
      `The voice pitch is too long. Keep it to ${OUTREACH_VOICE_MAX_WORDS} words`
    );
  }
  if (budget.characters > OUTREACH_VOICE_MAX_CHARACTERS) {
    throw new OutreachVoiceBudgetError(
      `The voice pitch is too long for the five pence limit. Keep it under ${OUTREACH_VOICE_MAX_CHARACTERS} characters`
    );
  }
  if (budget.estimatedCostGbp > OUTREACH_VOICE_MAX_COST_GBP) {
    throw new OutreachVoiceBudgetError(
      "This voice pitch would exceed the five pence ElevenLabs limit. Shorten it or use the Flash voice model"
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
