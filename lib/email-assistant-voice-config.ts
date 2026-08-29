import "server-only";

import { supabaseService } from "@/lib/supabase";

export type EmailAssistantVoiceConfig = {
  voiceId: string;
  voiceName: string;
  modelId: string;
};

const clean = (value: unknown, maximum: number): string =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

function safeEmailAssistantVoiceModel(value: unknown): string {
  const requested = clean(value, 120);
  return /^eleven_(flash|turbo)_/i.test(requested)
    ? requested
    : "eleven_flash_v2_5";
}

export async function resolveEmailAssistantVoiceConfig(scope: {
  userId: string;
  workspaceId: string;
}): Promise<EmailAssistantVoiceConfig> {
  const { data: profile, error } = await supabaseService
    .from("salesperson_profiles")
    .select("email_assistant_voice_id,email_assistant_voice_name")
    .eq("workspace_id", scope.workspaceId)
    .eq("user_id", scope.userId)
    .maybeSingle();
  if (error) throw error;

  const voiceId = clean(profile?.email_assistant_voice_id, 120);
  if (!voiceId) {
    throw new Error(
      "Choose a separate Email Assistant reply voice in My Sales Setup before creating a voice note. Brain and Outreach voices are never substituted."
    );
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs is not configured for this LiveCoach deployment");
  }
  return {
    voiceId,
    voiceName:
      clean(profile?.email_assistant_voice_name, 120) ||
      "My Email Assistant reply voice",
    modelId: safeEmailAssistantVoiceModel(
      process.env.ELEVENLABS_EMAIL_ASSISTANT_MODEL_ID
    ),
  };
}
