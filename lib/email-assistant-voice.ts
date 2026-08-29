import "server-only";

import {
  EMAIL_ASSISTANT_DRAFT_SELECT,
  type EmailAssistantDraft,
  loadOwnedEmailAssistantDraft,
} from "@/lib/email-assistant";
import {
  assertEmailAssistantVoiceWithinBudget,
  configuredEmailAssistantVoiceCostGbp,
  EMAIL_ASSISTANT_VOICE_BUCKET,
  EMAIL_ASSISTANT_VOICE_MIME,
  EmailAssistantVoiceBudgetError,
  emailAssistantEstimatedVoiceSeconds,
  emailAssistantVoiceApprovalHash,
  emailAssistantVoicePublicUrl,
  emailAssistantVoiceStoragePath,
  emailAssistantVoiceScriptHash,
  generateElevenLabsEmailAssistantAudio,
} from "@/lib/email-assistant-voice-note";
import { normaliseEmailAssistantVoiceScript } from "@/lib/email-assistant-voice-policy";
import { resolveEmailAssistantVoiceConfig } from "@/lib/email-assistant-voice-config";
import { supabaseService } from "@/lib/supabase";
import { logUsage } from "@/lib/usage";

export type EmailAssistantVoiceResult = {
  draft: EmailAssistantDraft;
  publicUrl: string;
  reused: boolean;
  voiceName: string;
  estimatedCostGbp: number;
  targetCostGbp: number;
  maximumCostGbp: number;
  overTargetCost: boolean;
  withinPreferredWordRange: boolean;
};

function requestError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export async function generateEmailAssistantVoiceNote(
  id: string
): Promise<EmailAssistantVoiceResult> {
  const { scope, draft } = await loadOwnedEmailAssistantDraft(id);
  if (!draft) throw requestError("Email draft not found", 404);
  if (!['draft', 'blocked'].includes(draft.status)) {
    throw requestError(
      "Create the personal voice note before approving the provider draft",
      409
    );
  }
  const script = normaliseEmailAssistantVoiceScript(draft.voice_script);
  if (!script) {
    throw requestError("Write the personal voice script first", 400);
  }

  let config: Awaited<ReturnType<typeof resolveEmailAssistantVoiceConfig>>;
  try {
    config = await resolveEmailAssistantVoiceConfig(scope);
  } catch (error: any) {
    throw requestError(
      String(
        error?.message ||
          "Choose your Email Assistant reply voice in My Sales Setup"
      ),
      400
    );
  }
  const budget = assertEmailAssistantVoiceWithinBudget(script, config.modelId);
  const scriptHash = emailAssistantVoiceScriptHash(
    script,
    config.voiceId,
    config.modelId
  );
  const publicUrl = emailAssistantVoicePublicUrl(draft.voice_public_token);
  if (
    draft.voice_status === "ready" &&
    draft.voice_script_hash === scriptHash &&
    draft.voice_audio_path
  ) {
    return {
      draft,
      publicUrl,
      reused: true,
      voiceName: config.voiceName,
      estimatedCostGbp:
        Number(draft.voice_estimated_cost_gbp) || budget.estimatedCostGbp,
      targetCostGbp: budget.targetCostGbp,
      maximumCostGbp: budget.maximumCostGbp,
      overTargetCost: budget.overTargetCost,
      withinPreferredWordRange: budget.withinPreferredWordRange,
    };
  }

  const approvalHash = emailAssistantVoiceApprovalHash(script);
  if (
    !draft.voice_script_approved_at ||
    draft.voice_script_approved_by !== scope.userId ||
    draft.voice_script_approved_hash !== approvalHash
  ) {
    throw requestError(
      "Approve this exact voice script before creating the paid audio. Nothing has been charged.",
      409
    );
  }
  if (draft.voice_status === "generating") {
    throw requestError("This voice note is already being generated", 409);
  }

  const { data: activeGeneration, error: activeGenerationError } =
    await supabaseService
      .from("email_assistant_drafts")
      .select("id,updated_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("voice_status", "generating")
      .neq("id", draft.id)
      .limit(1)
      .maybeSingle();
  if (activeGenerationError) throw activeGenerationError;
  if (activeGeneration) {
    const staleBefore = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const generationIsStale =
      Boolean(activeGeneration.updated_at) &&
      activeGeneration.updated_at < staleBefore;
    if (!generationIsStale) {
      throw requestError(
        "One personal voice note is already being created. Review the next script while it finishes.",
        409
      );
    }
    const { error: releaseError } = await supabaseService
      .from("email_assistant_drafts")
      .update({
        voice_status: "failed",
        voice_error:
          "A previous interrupted voice generation was released safely. No reusable audio was saved.",
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("id", activeGeneration.id)
      .eq("voice_status", "generating")
      .lte("updated_at", staleBefore);
    if (releaseError) throw releaseError;
  }

  const { data: claimed, error: claimError } = await supabaseService
    .from("email_assistant_drafts")
    .update({
      voice_status: "generating",
      voice_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("id", draft.id)
    .in("status", ["draft", "blocked"])
    .in("voice_status", ["none", "script_ready", "ready", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw requestError("This voice note is already being generated", 409);
  }

  try {
    const generated = await generateElevenLabsEmailAssistantAudio({ script, config });
    const audioPath = emailAssistantVoiceStoragePath({
      workspaceId: scope.workspaceId,
      ownerId: scope.userId,
      draftId: draft.id,
      scriptHash,
    });
    const { error: uploadError } = await supabaseService.storage
      .from(EMAIL_ASSISTANT_VOICE_BUCKET)
      .upload(audioPath, generated.audio, {
        contentType: EMAIL_ASSISTANT_VOICE_MIME,
        cacheControl: "31536000",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const generatedAt = new Date().toISOString();
    const estimatedSeconds = emailAssistantEstimatedVoiceSeconds(script);
    const { data: saved, error: saveError } = await supabaseService
      .from("email_assistant_drafts")
      .update({
        voice_script: script,
        voice_status: "ready",
        voice_audio_path: audioPath,
        voice_audio_mime: EMAIL_ASSISTANT_VOICE_MIME,
        voice_generated_at: generatedAt,
        voice_script_hash: scriptHash,
        voice_model_id: config.modelId,
        voice_provider_voice_id: config.voiceId,
        voice_provider_request_id: generated.requestId,
        voice_estimated_seconds: estimatedSeconds,
        voice_character_count: generated.characters,
        voice_estimated_cost_gbp: budget.estimatedCostGbp,
        voice_error: null,
        updated_at: generatedAt,
      })
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("id", draft.id)
      .eq("voice_status", "generating")
      .eq("voice_script", script)
      .select(EMAIL_ASSISTANT_DRAFT_SELECT)
      .maybeSingle();
    if (saveError) throw saveError;
    if (!saved) {
      throw new Error(
        "The draft changed while its voice note was being generated. Review the latest script and create a fresh preview."
      );
    }

    const [auditResult] = await Promise.all([
      supabaseService.from("access_audit_events").insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: "email_assistant_voice_generated",
        target_table: "email_assistant_drafts",
        target_id: draft.id,
        previous_scope: { voiceStatus: draft.voice_status },
        next_scope: {
          voiceStatus: "ready",
          scriptHash,
          estimatedCostGbp: budget.estimatedCostGbp,
        },
      }),
      logUsage(
        "email_assistant_voice_note",
        configuredEmailAssistantVoiceCostGbp(
          generated.characters,
          config.modelId
        ),
        {
          provider: "elevenlabs",
          modelId: config.modelId,
          characters: generated.characters,
          estimatedSeconds,
          targetCostGbp: budget.targetCostGbp,
          maximumCostGbp: budget.maximumCostGbp,
          providerBilledSeparately: true,
        },
        scope
      ),
    ]);
    if (auditResult.error) {
      console.error(
        "Email assistant voice generation audit failed",
        auditResult.error.message
      );
    }

    return {
      draft: saved as EmailAssistantDraft,
      publicUrl,
      reused: false,
      voiceName: config.voiceName,
      estimatedCostGbp: budget.estimatedCostGbp,
      targetCostGbp: budget.targetCostGbp,
      maximumCostGbp: budget.maximumCostGbp,
      overTargetCost: budget.overTargetCost,
      withinPreferredWordRange: budget.withinPreferredWordRange,
    };
  } catch (error: any) {
    const concurrentGeneration =
      error?.code === "23505" &&
      String(error?.message || "").includes(
        "email_assistant_one_voice_generation_per_owner_idx"
      );
    const detail = String(
      concurrentGeneration
        ? "One personal voice note is already being created. Review the next script while it finishes."
        : error?.message || "Voice note generation failed"
    ).slice(0, 500);
    await supabaseService
      .from("email_assistant_drafts")
      .update({
        voice_status: "failed",
        voice_error: detail,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("id", draft.id)
      .eq("voice_status", "generating");
    if (concurrentGeneration) throw requestError(detail, 409);
    if (error instanceof EmailAssistantVoiceBudgetError) {
      throw requestError(detail, error.status);
    }
    throw requestError(detail, Number(error?.status) || 502);
  }
}
