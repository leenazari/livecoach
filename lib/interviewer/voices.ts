// British voices only, from https://developers.deepgram.com/docs/tts-models
// checked 14 Nov 2026. Accent column "British", language en-gb.
// Aura-2: Draco (masculine), Pandora (feminine).
// Aura-1: Helios (masculine), Athena (feminine).
// No other Aura-2 voice on that page is listed as British.
// aura-2-pandora-en is the existing database default and is used only when a
// stored voice is missing or not in this list. The owner form does not preselect it.

export const INTERVIEWER_VOICES = [
  {
    id: "aura-2-draco-en",
    name: "Draco",
    generation: "Aura-2",
    gender: "masculine",
    accent: "British",
    language: "en-gb",
    description: "Warm, approachable, trustworthy, baritone",
  },
  {
    id: "aura-2-pandora-en",
    name: "Pandora",
    generation: "Aura-2",
    gender: "feminine",
    accent: "British",
    language: "en-gb",
    description: "Smooth, calm, melodic, breathy",
  },
  {
    id: "aura-helios-en",
    name: "Helios",
    generation: "Aura-1",
    gender: "masculine",
    accent: "British",
    language: "en-gb",
    description: "Professional, clear, confident",
  },
  {
    id: "aura-athena-en",
    name: "Athena",
    generation: "Aura-1",
    gender: "feminine",
    accent: "British",
    language: "en-gb",
    description: "Calm, smooth, professional",
  },
] as const;

export type InterviewerVoiceId = (typeof INTERVIEWER_VOICES)[number]["id"];

export const FALLBACK_INTERVIEWER_VOICE: InterviewerVoiceId = "aura-2-pandora-en";

export function isInterviewerVoiceId(value: unknown): value is InterviewerVoiceId {
  return INTERVIEWER_VOICES.some((voice) => voice.id === value);
}

export function interviewerVoice(value: unknown) {
  return INTERVIEWER_VOICES.find((voice) => voice.id === value) || null;
}

export function interviewerVoiceOrFallback(value: unknown): InterviewerVoiceId {
  return isInterviewerVoiceId(value) ? value : FALLBACK_INTERVIEWER_VOICE;
}
