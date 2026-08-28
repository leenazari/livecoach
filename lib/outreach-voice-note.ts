import "server-only";

import { createHash } from "crypto";
import { publicAppOrigin } from "@/lib/public-app-url";
import { supabaseService } from "@/lib/supabase";
import type { OutreachIdentity } from "@/lib/outreach-identity";

export const OUTREACH_VOICE_BUCKET = "outreach-voice-notes";
export const OUTREACH_VOICE_MIME = "audio/mpeg";

export type OutreachVoiceConfig = {
  voiceId: string;
  voiceName: string;
  modelId: string;
  usingOwnerDefault: boolean;
};

const clean = (value: unknown, max: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export function normaliseOutreachVoiceScript(value: unknown): string {
  const words = clean(value, 1800)
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 135);
  return words.join(" ");
}

export function estimatedVoiceSeconds(script: string): number {
  const wordCount = script.split(/\s+/).filter(Boolean).length;
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
    modelId:
      clean(process.env.ELEVENLABS_OUTREACH_MODEL_ID, 120) ||
      "eleven_multilingual_v2",
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
  if (script.split(/\s+/).filter(Boolean).length < 90) {
    throw new Error("The voice pitch is too short. Expand it before generating audio");
  }
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
    characters: script.length,
  };
}

export function configuredVoiceNoteCostGbp(characters: number): number {
  const perThousand = Number(
    process.env.ELEVENLABS_COST_GBP_PER_1000_CHARS || 0
  );
  if (!Number.isFinite(perThousand) || perThousand <= 0) return 0;
  return Number(((characters / 1000) * perThousand).toFixed(6));
}
