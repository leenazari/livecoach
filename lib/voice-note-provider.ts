import "server-only";

import { createHash } from "crypto";

export const VOICE_NOTE_BUCKET = "outreach-voice-notes";
export const VOICE_NOTE_MIME = "audio/mpeg";

export type ElevenLabsVoiceSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

export type VoiceProviderConfig = {
  voiceId: string;
  voiceName: string;
  modelId: string;
};

export function voiceScriptHash(
  script: string,
  voiceId: string,
  modelId: string
): string {
  return createHash("sha256")
    .update(`${voiceId}\n${modelId}\n${script}`)
    .digest("hex");
}

export function approvedVoiceScriptHash(script: string): string {
  return createHash("sha256").update(script).digest("hex");
}

export async function generateElevenLabsVoiceAudio(input: {
  script: string;
  config: VoiceProviderConfig;
  settings: ElevenLabsVoiceSettings;
}): Promise<{
  audio: Buffer;
  requestId: string | null;
  characters: number;
}> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.config.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
        "Content-Type": "application/json",
        Accept: VOICE_NOTE_MIME,
      },
      body: JSON.stringify({
        text: input.script,
        model_id: input.config.modelId,
        voice_settings: input.settings,
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
  if (audio.length < 1000) {
    throw new Error("ElevenLabs returned an empty voice note");
  }
  return {
    audio,
    requestId:
      response.headers.get("request-id") ||
      response.headers.get("x-request-id"),
    characters: input.script.length,
  };
}
