export const EMAIL_TONES = [
  "warm_direct",
  "consultative",
  "concise",
  "energetic",
] as const;

export const COACHING_STYLES = ["direct", "balanced", "supportive"] as const;
export const SUGGESTION_FREQUENCIES = ["low", "standard", "high"] as const;

export type EmailTone = (typeof EMAIL_TONES)[number];
export type CoachingStyle = (typeof COACHING_STYLES)[number];
export type SuggestionFrequency = (typeof SUGGESTION_FREQUENCIES)[number];

export type SalesProfile = {
  roleTitle: string;
  salesGoal: string;
  emailTone: EmailTone;
  emailSignoff: string;
  bookingUrl: string;
  emailAssistantVoiceId: string;
  emailAssistantVoiceName: string;
  outreachVoiceId: string;
  outreachVoiceName: string;
  coachingStyle: CoachingStyle;
  suggestionFrequency: SuggestionFrequency;
  productFocus: string[];
  customerFocus: string[];
  workdayStart: string;
  workdayEnd: string;
  timezone: string;
  personalContext: string;
  completedAt: string | null;
  updatedAt: string | null;
};

export type SalesProfileIdentity = {
  displayName: string;
  accountEmail: string;
  transcriberName: string;
  connector: {
    provider: "google" | "microsoft" | null;
    email: string | null;
  };
};

export type SalesProfileResponse = {
  profile: SalesProfile;
  identity: SalesProfileIdentity;
};

export const DEFAULT_SALES_PROFILE: SalesProfile = {
  roleTitle: "",
  salesGoal: "",
  emailTone: "warm_direct",
  emailSignoff: "",
  bookingUrl: "",
  emailAssistantVoiceId: "",
  emailAssistantVoiceName: "",
  outreachVoiceId: "",
  outreachVoiceName: "",
  coachingStyle: "balanced",
  suggestionFrequency: "standard",
  productFocus: [],
  customerFocus: [],
  workdayStart: "09:00",
  workdayEnd: "17:30",
  timezone: "Europe/London",
  personalContext: "",
  completedAt: null,
  updatedAt: null,
};

export const EMAIL_TONE_LABELS: Record<EmailTone, string> = {
  warm_direct: "Warm and direct",
  consultative: "Consultative",
  concise: "Very concise",
  energetic: "Energetic",
};

export const COACHING_STYLE_LABELS: Record<CoachingStyle, string> = {
  direct: "Direct challenge",
  balanced: "Balanced",
  supportive: "Supportive",
};

export const SUGGESTION_FREQUENCY_LABELS: Record<SuggestionFrequency, string> = {
  low: "Only critical moments",
  standard: "Balanced frequency",
  high: "More frequent guidance",
};
