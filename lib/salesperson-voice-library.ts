import "server-only";

import type { SalespersonVoiceChoice } from "@/lib/salesperson-voice-library-types";

const ELEVENLABS_API_ORIGIN = "https://api.elevenlabs.io";

const clean = (value: unknown, max: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const safePreviewUrl = (value: unknown): string => {
  const candidate = clean(value, 1000);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

function elevenLabsKey(): string {
  const key = clean(process.env.ELEVENLABS_API_KEY, 500);
  if (!key)
    throw new Error("ElevenLabs is not configured for this LiveCoach deployment");
  return key;
}

function compactVoice(value: any): SalespersonVoiceChoice | null {
  const id = clean(value?.voice_id, 120);
  const name = clean(value?.name, 120);
  if (!id || !name) return null;
  const labels =
    value?.labels && typeof value.labels === "object" ? value.labels : {};
  return {
    id,
    name,
    category: clean(value?.category, 40) || "premade",
    description: clean(value?.description, 240),
    previewUrl: safePreviewUrl(value?.preview_url),
    accent: clean(labels.accent, 60),
    age: clean(labels.age, 60),
    gender: clean(labels.gender, 60),
    useCase: clean(labels.use_case, 80),
  };
}

function voiceOrder(
  a: SalespersonVoiceChoice,
  b: SalespersonVoiceChoice
): number {
  const british = (voice: SalespersonVoiceChoice) =>
    /british|english|uk/i.test(voice.accent) ? 0 : 1;
  return british(a) - british(b) || a.name.localeCompare(b.name, "en-GB");
}

export async function listSalespersonStockVoices(): Promise<
  SalespersonVoiceChoice[]
> {
  const query = new URLSearchParams({
    voice_type: "default",
    page_size: "40",
    include_total_count: "false",
    sort: "name",
    sort_direction: "asc",
  });
  const response = await fetch(`${ELEVENLABS_API_ORIGIN}/v2/voices?${query}`, {
    headers: { "xi-api-key": elevenLabsKey() },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "ElevenLabs rejected the configured account"
        : `The ElevenLabs voice library is temporarily unavailable (${response.status})`
    );
  }
  const payload = await response.json();
  const voices = Array.isArray(payload?.voices)
    ? payload.voices
        .map(compactVoice)
        .filter(
          (
            voice: SalespersonVoiceChoice | null
          ): voice is SalespersonVoiceChoice => Boolean(voice)
        )
        .sort(voiceOrder)
    : [];
  if (!voices.length)
    throw new Error("No stock ElevenLabs voices are available for this account");
  return voices;
}

export async function validateSalespersonVoiceSelection(
  voiceId: string
): Promise<{ id: string; name: string }> {
  const id = clean(voiceId, 120);
  if (!id) throw new Error("Choose a voice");
  const response = await fetch(
    `${ELEVENLABS_API_ORIGIN}/v1/voices/${encodeURIComponent(id)}`,
    {
      headers: { "xi-api-key": elevenLabsKey() },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404 || response.status === 422
        ? "That ElevenLabs voice is not available to this LiveCoach account"
        : "The selected ElevenLabs voice could not be verified right now"
    );
  }
  const voice = await response.json();
  const canonicalId = clean(voice?.voice_id, 120);
  const canonicalName = clean(voice?.name, 120);
  if (canonicalId !== id || !canonicalName)
    throw new Error("The selected ElevenLabs voice could not be verified");
  return { id: canonicalId, name: canonicalName };
}
