import { NextResponse } from "next/server";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import {
  assertOutreachVoiceWithinBudget,
  configuredVoiceNoteCostGbp,
  estimatedVoiceSeconds,
  generateElevenLabsOutreachAudio,
  normaliseOutreachVoiceScript,
  OUTREACH_VOICE_BUCKET,
  OUTREACH_VOICE_MIME,
  outreachVoiceApprovalHash,
  outreachVoicePublicUrl,
  outreachVoiceScriptHash,
  outreachVoiceStoragePath,
  OutreachVoiceBudgetError,
  resolveOutreachVoiceConfig,
} from "@/lib/outreach-voice-note";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { logUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  let sender: Awaited<ReturnType<typeof resolveOutreachIdentity>> | null = null;
  let messageId = "";
  try {
    sender = await resolveOutreachIdentity();
    const { data: message, error: messageError } = await supabaseAdmin
      .from("outreach_messages")
      .select("*")
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message)
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    messageId = message.id;
    if (!["draft", "failed"].includes(message.status)) {
      return NextResponse.json(
        {
          error:
            "Create and preview the voice note before approving or queueing the email",
        },
        { status: 409 }
      );
    }
    if (message.from_email !== sender.senderEmail) {
      return NextResponse.json(
        { error: "Sender safety check failed" },
        { status: 403 }
      );
    }
    const script = normaliseOutreachVoiceScript(message.voice_script);
    if (!script) {
      return NextResponse.json(
        { error: "Prepare or write the personal voice pitch first" },
        { status: 400 }
      );
    }
    const config = await resolveOutreachVoiceConfig(sender);
    // This happens before the row is claimed and before ElevenLabs is called.
    // An over-budget script therefore costs nothing and remains editable.
    const budget = assertOutreachVoiceWithinBudget(script, config.modelId);
    const scriptHash = outreachVoiceScriptHash(
      script,
      config.voiceId,
      config.modelId
    );
    const publicUrl = outreachVoicePublicUrl(message.voice_public_token);
    if (
      message.voice_status === "ready" &&
      message.voice_script_hash === scriptHash &&
      message.voice_audio_path
    ) {
      return NextResponse.json(
        {
          message,
          publicUrl,
          reused: true,
          voiceName: config.voiceName,
          estimatedCostGbp:
            Number(message.voice_estimated_cost_gbp) ||
            budget.estimatedCostGbp,
          targetCostGbp: budget.targetCostGbp,
          maximumCostGbp: budget.maximumCostGbp,
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const approvedHash = outreachVoiceApprovalHash(script);
    if (
      !message.voice_script_approved_at ||
      message.voice_script_approved_by !== sender.userId ||
      message.voice_script_approved_hash !== approvedHash
    ) {
      return NextResponse.json(
        {
          error:
            "Approve this exact voice script before creating the paid audio. Nothing has been charged.",
        },
        { status: 409 }
      );
    }
    if (message.voice_status === "generating") {
      return NextResponse.json(
        { error: "This voice note is already being generated" },
        { status: 409 }
      );
    }

    const { data: activeGeneration, error: activeGenerationError } =
      await supabaseAdmin
        .from("outreach_messages")
        .select("id,updated_at")
        .eq("workspace_id", sender.workspaceId)
        .eq("sender_user_id", sender.userId)
        .eq("voice_status", "generating")
        .neq("id", message.id)
        .limit(1)
        .maybeSingle();
    if (activeGenerationError) throw activeGenerationError;
    if (activeGeneration) {
      // A serverless request can be interrupted after it claims the row. The
      // provider timeout is 45 seconds and this route is capped at 60 seconds,
      // so a three-minute generating row is conclusively stale and safe to
      // release. This prevents one failed request blocking all future previews.
      const staleBefore = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const generationIsStale =
        Boolean(activeGeneration.updated_at) &&
        activeGeneration.updated_at < staleBefore;
      if (generationIsStale) {
        const { error: releaseError } = await supabaseAdmin
          .from("outreach_messages")
          .update({
            voice_status: "failed",
            voice_error:
              "A previous interrupted voice generation was released safely. No reusable audio was saved.",
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", sender.workspaceId)
          .eq("sender_user_id", sender.userId)
          .eq("id", activeGeneration.id)
          .eq("voice_status", "generating")
          .lte("updated_at", staleBefore);
        if (releaseError) throw releaseError;
      } else {
        return NextResponse.json(
          {
            error:
              "One personal voice note is already being created. Review the next script while it finishes.",
          },
          { status: 409 }
        );
      }
    }

    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("outreach_messages")
      .update({
        voice_status: "generating",
        voice_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", message.id)
      .in("voice_status", ["none", "script_ready", "ready", "failed"])
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      return NextResponse.json(
        { error: "This voice note is already being generated" },
        { status: 409 }
      );
    }

    const generated = await generateElevenLabsOutreachAudio({ script, config });
    const audioPath = outreachVoiceStoragePath({
      workspaceId: sender.workspaceId,
      senderUserId: sender.userId,
      messageId: message.id,
      scriptHash,
    });
    const { error: uploadError } = await supabaseService.storage
      .from(OUTREACH_VOICE_BUCKET)
      .upload(audioPath, generated.audio, {
        contentType: OUTREACH_VOICE_MIME,
        cacheControl: "31536000",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const generatedAt = new Date().toISOString();
    const estimatedSeconds = estimatedVoiceSeconds(script);
    const { data: saved, error: saveError } = await supabaseAdmin
      .from("outreach_messages")
      .update({
        voice_script: script,
        voice_status: "ready",
        voice_audio_path: audioPath,
        voice_audio_mime: OUTREACH_VOICE_MIME,
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
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", message.id)
      .eq("voice_status", "generating")
      .eq("voice_script", script)
      .select("*")
      .maybeSingle();
    if (saveError) throw saveError;
    if (!saved) {
      throw new Error(
        "The draft changed while its voice note was being generated. Review the latest script and create a fresh preview."
      );
    }

    await Promise.all([
      supabaseAdmin.from("outreach_events").insert({
        workspace_id: sender.workspaceId,
        owner_id: sender.userId,
        visibility: "team",
        campaign_id: message.campaign_id,
        prospect_id: message.prospect_id,
        message_id: message.id,
        kind: "voice_generated",
        metadata: {
          modelId: config.modelId,
          voiceName: config.voiceName,
          characters: generated.characters,
          estimatedSeconds,
          estimatedCostGbp: budget.estimatedCostGbp,
          targetCostGbp: budget.targetCostGbp,
          maximumCostGbp: budget.maximumCostGbp,
          overTargetCost: budget.overTargetCost,
          withinPreferredWordRange: budget.withinPreferredWordRange,
          rateGbpPerThousandCharacters:
            budget.rateGbpPerThousandCharacters,
          scriptHash,
        },
      }),
      logUsage(
        "outreach_voice_note",
        configuredVoiceNoteCostGbp(
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
          overTargetCost: budget.overTargetCost,
          withinPreferredWordRange: budget.withinPreferredWordRange,
          rateGbpPerThousandCharacters:
            budget.rateGbpPerThousandCharacters,
          providerBilledSeparately: true,
          pricingConfigured: true,
        },
        { userId: sender.userId, workspaceId: sender.workspaceId }
      ),
    ]);

    return NextResponse.json(
      {
        message: saved,
        publicUrl,
        reused: false,
        voiceName: config.voiceName,
        estimatedCostGbp: budget.estimatedCostGbp,
        targetCostGbp: budget.targetCostGbp,
        maximumCostGbp: budget.maximumCostGbp,
        overTargetCost: budget.overTargetCost,
        withinPreferredWordRange: budget.withinPreferredWordRange,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    const concurrentGeneration =
      error?.code === "23505" &&
      String(error?.message || "").includes(
        "outreach_messages_one_voice_generation_per_sender_idx"
      );
    const detail = String(
      concurrentGeneration
        ? "One personal voice note is already being created. Review the next script while it finishes."
        : error?.message || "Voice note generation failed"
    ).slice(0, 500);
    if (messageId && sender) {
      await supabaseAdmin
        .from("outreach_messages")
        .update({
          voice_status: "failed",
          voice_error: detail,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", sender.workspaceId)
        .eq("sender_user_id", sender.userId)
        .eq("id", messageId)
        .eq("voice_status", "generating");
    }
    return NextResponse.json(
      { error: detail },
      {
        status: concurrentGeneration
          ? 409
          : error instanceof OutreachVoiceBudgetError
            ? error.status
            : 502,
      }
    );
  }
}
