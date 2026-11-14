// Aura English voices from https://developers.deepgram.com/docs/tts-models
// checked 14 Nov 2026. Aura-2 English catalogue (the "all available" table)
// plus every Aura-1 English voice. Spanish, Dutch, French, German, Italian
// and Japanese voices are not included. Tags are copied from that page.
// aura-2-pandora-en is only the fallback when a saved id is missing.

export type AuraVoice = {
  id: string;
  name: string;
  generation: "Aura-2" | "Aura-1";
  gender: "feminine" | "masculine";
  age: string;
  language: string;
  accent: string;
  characteristics: string;
  useCases: string;
};

type VoiceRow = [string, "feminine" | "masculine", string, string, string, string, string];

function voice(generation: "Aura-2" | "Aura-1", row: VoiceRow): AuraVoice {
  const [id, gender, age, language, accent, characteristics, useCases] = row;
  const parts = id.split("-");
  return {
    id,
    name: parts[parts.length - 2] || id,
    generation,
    gender,
    age,
    language,
    accent,
    characteristics,
    useCases,
  };
}

const AURA_2: VoiceRow[] = [
  ["aura-2-amalthea-en", "feminine", "Young Adult", "en-ph", "Filipino", "Engaging, Natural, Cheerful", "Casual chat"],
  ["aura-2-andromeda-en", "feminine", "Adult", "en-us", "American", "Casual, Expressive, Comfortable", "Customer service, IVR"],
  ["aura-2-apollo-en", "masculine", "Adult", "en-us", "American", "Confident, Comfortable, Casual", "Casual chat"],
  ["aura-2-arcas-en", "masculine", "Adult", "en-us", "American", "Natural, Smooth, Clear, Comfortable", "Customer service, casual chat"],
  ["aura-2-aries-en", "masculine", "Adult", "en-us", "American", "Warm, Energetic, Caring", "Casual chat"],
  ["aura-2-asteria-en", "feminine", "Adult", "en-us", "American", "Clear, Confident, Knowledgeable, Energetic", "Advertising"],
  ["aura-2-athena-en", "feminine", "Mature", "en-us", "American", "Calm, Smooth, Professional", "Storytelling"],
  ["aura-2-atlas-en", "masculine", "Mature", "en-us", "American", "Enthusiastic, Confident, Approachable, Friendly", "Advertising"],
  ["aura-2-aurora-en", "feminine", "Adult", "en-us", "American", "Cheerful, Expressive, Energetic", "Interview"],
  ["aura-2-callista-en", "feminine", "Adult", "en-us", "American", "Clear, Energetic, Professional, Smooth", "IVR"],
  ["aura-2-cora-en", "feminine", "Adult", "en-us", "American", "Smooth, Melodic, Caring", "Storytelling"],
  ["aura-2-cordelia-en", "feminine", "Young Adult", "en-us", "American", "Approachable, Warm, Polite", "Storytelling"],
  ["aura-2-delia-en", "feminine", "Young Adult", "en-us", "American", "Casual, Friendly, Cheerful, Breathy", "Interview"],
  ["aura-2-draco-en", "masculine", "Adult", "en-gb", "British", "Warm, Approachable, Trustworthy, Baritone", "Storytelling"],
  ["aura-2-electra-en", "feminine", "Adult", "en-us", "American", "Professional, Engaging, Knowledgeable", "IVR, advertising, customer service"],
  ["aura-2-harmonia-en", "feminine", "Adult", "en-us", "American", "Empathetic, Clear, Calm, Confident", "Customer service"],
  ["aura-2-helena-en", "feminine", "Adult", "en-us", "American", "Caring, Natural, Positive, Friendly, Raspy", "IVR, casual chat"],
  ["aura-2-hera-en", "feminine", "Adult", "en-us", "American", "Smooth, Warm, Professional", "Informative"],
  ["aura-2-hermes-en", "masculine", "Adult", "en-us", "American", "Expressive, Engaging, Professional", "Informative"],
  ["aura-2-hyperion-en", "masculine", "Adult", "en-au", "Australian", "Caring, Warm, Empathetic", "Interview"],
  ["aura-2-iris-en", "feminine", "Young Adult", "en-us", "American", "Cheerful, Positive, Approachable", "IVR, advertising, customer service"],
  ["aura-2-janus-en", "feminine", "Adult", "en-us", "American", "Southern, Smooth, Trustworthy", "Storytelling"],
  ["aura-2-juno-en", "feminine", "Adult", "en-us", "American", "Natural, Engaging, Melodic, Breathy", "Interview"],
  ["aura-2-jupiter-en", "masculine", "Adult", "en-us", "American", "Expressive, Knowledgeable, Baritone", "Informative"],
  ["aura-2-luna-en", "feminine", "Young Adult", "en-us", "American", "Friendly, Natural, Engaging", "IVR"],
  ["aura-2-mars-en", "masculine", "Adult", "en-us", "American", "Smooth, Patient, Trustworthy, Baritone", "Customer service"],
  ["aura-2-minerva-en", "feminine", "Adult", "en-us", "American", "Positive, Friendly, Natural", "Storytelling"],
  ["aura-2-neptune-en", "masculine", "Adult", "en-us", "American", "Professional, Patient, Polite", "Customer service"],
  ["aura-2-odysseus-en", "masculine", "Adult", "en-us", "American", "Calm, Smooth, Comfortable, Professional", "Advertising"],
  ["aura-2-ophelia-en", "feminine", "Adult", "en-us", "American", "Expressive, Enthusiastic, Cheerful", "Interview"],
  ["aura-2-orion-en", "masculine", "Adult", "en-us", "American", "Approachable, Comfortable, Calm, Polite", "Informative"],
  ["aura-2-orpheus-en", "masculine", "Adult", "en-us", "American", "Professional, Clear, Confident, Trustworthy", "Customer service, storytelling"],
  ["aura-2-pandora-en", "feminine", "Adult", "en-gb", "British", "Smooth, Calm, Melodic, Breathy", "IVR, informative"],
  ["aura-2-phoebe-en", "feminine", "Adult", "en-us", "American", "Energetic, Warm, Casual", "Customer service"],
  ["aura-2-pluto-en", "masculine", "Adult", "en-us", "American", "Smooth, Calm, Empathetic, Baritone", "Interview, storytelling"],
  ["aura-2-saturn-en", "masculine", "Adult", "en-us", "American", "Knowledgeable, Confident, Baritone", "Customer service"],
  ["aura-2-selene-en", "feminine", "Adult", "en-us", "American", "Expressive, Engaging, Energetic", "Informative"],
  ["aura-2-thalia-en", "feminine", "Adult", "en-us", "American", "Clear, Confident, Energetic, Enthusiastic", "Casual chat, customer service, IVR"],
  ["aura-2-theia-en", "feminine", "Adult", "en-au", "Australian", "Expressive, Polite, Sincere", "Informative"],
  ["aura-2-vesta-en", "feminine", "Adult", "en-us", "American", "Natural, Expressive, Patient, Empathetic", "Customer service, interview, storytelling"],
  ["aura-2-zeus-en", "masculine", "Adult", "en-us", "American", "Deep, Trustworthy, Smooth", "IVR"],
];

const AURA_1: VoiceRow[] = [
  ["aura-asteria-en", "feminine", "Adult", "en-us", "American", "Clear, Confident, Knowledgeable, Energetic", "Advertising"],
  ["aura-luna-en", "feminine", "Young Adult", "en-us", "American", "Friendly, Natural, Engaging", "IVR"],
  ["aura-stella-en", "feminine", "Adult", "en-us", "American", "Clear, Professional, Engaging", "Customer service"],
  ["aura-athena-en", "feminine", "Mature", "en-gb", "British", "Calm, Smooth, Professional", "Storytelling"],
  ["aura-hera-en", "feminine", "Adult", "en-us", "American", "Smooth, Warm, Professional", "Informative"],
  ["aura-orion-en", "masculine", "Adult", "en-us", "American", "Approachable, Comfortable, Calm, Polite", "Informative"],
  ["aura-arcas-en", "masculine", "Adult", "en-us", "American", "Natural, Smooth, Clear, Comfortable", "Customer service, casual chat"],
  ["aura-perseus-en", "masculine", "Adult", "en-us", "American", "Confident, Professional, Clear", "Customer service"],
  ["aura-angus-en", "masculine", "Adult", "en-ie", "Irish", "Warm, Friendly, Natural", "Storytelling"],
  ["aura-orpheus-en", "masculine", "Adult", "en-us", "American", "Professional, Clear, Confident, Trustworthy", "Customer service, storytelling"],
  ["aura-helios-en", "masculine", "Adult", "en-gb", "British", "Professional, Clear, Confident", "Customer service"],
  ["aura-zeus-en", "masculine", "Adult", "en-us", "American", "Deep, Trustworthy, Smooth", "IVR"],
];

export const INTERVIEWER_VOICES: readonly AuraVoice[] = [
  ...AURA_2.map((row) => voice("Aura-2", row)),
  ...AURA_1.map((row) => voice("Aura-1", row)),
];

export type InterviewerVoiceId = string;

export const FALLBACK_INTERVIEWER_VOICE = "aura-2-pandora-en";

export function isInterviewerVoiceId(value: unknown): value is string {
  return typeof value === "string" && INTERVIEWER_VOICES.some((item) => item.id === value);
}

export function interviewerVoice(value: unknown): AuraVoice | null {
  return INTERVIEWER_VOICES.find((item) => item.id === value) || null;
}

export function interviewerVoiceOrFallback(value: unknown): string {
  return isInterviewerVoiceId(value) ? value : FALLBACK_INTERVIEWER_VOICE;
}

export function voiceLabel(value: unknown): string {
  const found = interviewerVoice(value);
  if (!found) return "Voice";
  return found.name.slice(0, 1).toUpperCase() + found.name.slice(1);
}
