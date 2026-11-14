// Deepgram Aura-2 voice catalogue, checked against
// https://developers.deepgram.com/docs/tts-models (English voices, accent en-gb).
// Exactly one male and one female voice. Both are British English.
// Aura-2 ids use the form aura-2-{name}-en. The first-generation British voices
// (aura-athena-en, aura-helios-en) are not used.

export const INTERVIEWER_VOICES = [
  {
    id: "aura-2-draco-en",
    name: "Draco",
    gender: "male",
    accent: "British English",
    language: "en-gb",
    description: "Warm, approachable, trustworthy baritone",
  },
  {
    id: "aura-2-pandora-en",
    name: "Pandora",
    gender: "female",
    accent: "British English",
    language: "en-gb",
    description: "Smooth, calm, melodic",
  },
] as const;

export type InterviewerVoiceId = (typeof INTERVIEWER_VOICES)[number]["id"];

export const DEFAULT_INTERVIEWER_VOICE: InterviewerVoiceId = "aura-2-pandora-en";

export function isInterviewerVoiceId(value: unknown): value is InterviewerVoiceId {
  return INTERVIEWER_VOICES.some((voice) => voice.id === value);
}

export function interviewerVoice(value: unknown) {
  return INTERVIEWER_VOICES.find((voice) => voice.id === value) || INTERVIEWER_VOICES[1];
}
