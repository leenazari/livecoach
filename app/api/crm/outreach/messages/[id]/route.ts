import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import {
  assertOutreachVoiceWithinBudget,
  estimatedVoiceSeconds,
  normaliseOutreachVoiceScript,
  outreachVoiceApprovalHash,
  OutreachVoiceBudgetError,
  resolveOutreachVoiceConfig,
} from "@/lib/outreach-voice-note";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { outreachSafetyError } from "@/lib/outreach-team-safety";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sender = await resolveOutreachIdentity();
    const body = await req.json();
    const { data: existing } = await supabaseAdmin
      .from("outreach_messages")
      .select("*")
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (!existing)
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (["sending", "sent"].includes(existing.status))
      return NextResponse.json({ error: "An email being delivered or already sent cannot be changed" }, { status: 400 });
    if (existing.from_email !== sender.senderEmail)
      return NextResponse.json({ error: "Sender safety check failed" }, { status: 403 });
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    const nextSubject = typeof body.subject === "string" && body.subject.trim()
      ? removeDashesFromProse(body.subject.trim()).slice(0, 120)
      : removeDashesFromProse(existing.subject);
    const nextBody = typeof body.body_text === "string" && body.body_text.trim()
      ? removeDashesFromProse(body.body_text.trim()).slice(0, 4000)
      : removeDashesFromProse(existing.body_text);
    const nextVoiceScript = typeof body.voice_script === "string"
      ? normaliseOutreachVoiceScript(body.voice_script)
      : normaliseOutreachVoiceScript(existing.voice_script);
    const voiceChanged = nextVoiceScript !== normaliseOutreachVoiceScript(existing.voice_script);
    const contentChanged =
      nextSubject !== existing.subject ||
      nextBody !== existing.body_text ||
      voiceChanged;
    const voiceApprovalRequested = body.approve_voice_script === true;
    let voiceApprovalRecorded = false;
    let voiceApprovalBudget: ReturnType<typeof assertOutreachVoiceWithinBudget> | null = null;
    patch.subject = nextSubject;
    patch.body_text = nextBody;
    patch.voice_script = nextVoiceScript || null;
    if (voiceChanged) {
      patch.voice_status = nextVoiceScript ? "script_ready" : "none";
      patch.voice_audio_path = null;
      patch.voice_audio_mime = null;
      patch.voice_generated_at = null;
      patch.voice_script_hash = null;
      patch.voice_model_id = null;
      patch.voice_provider_voice_id = null;
      patch.voice_provider_request_id = null;
      patch.voice_estimated_seconds = nextVoiceScript
        ? estimatedVoiceSeconds(nextVoiceScript)
        : null;
      patch.voice_character_count = null;
      patch.voice_estimated_cost_gbp = null;
      patch.voice_error = null;
      patch.voice_script_approved_at = null;
      patch.voice_script_approved_by = null;
      patch.voice_script_approved_hash = null;
    }
    if (voiceApprovalRequested) {
      if (!nextVoiceScript)
        return NextResponse.json(
          { error: "Write the personal voice script before approving it" },
          { status: 400 }
        );
      if (existing.voice_status === "generating")
        return NextResponse.json(
          { error: "Wait for the current voice note to finish" },
          { status: 409 }
        );
      const config = await resolveOutreachVoiceConfig(sender);
      voiceApprovalBudget = assertOutreachVoiceWithinBudget(
        nextVoiceScript,
        config.modelId
      );
      const approvalHash = outreachVoiceApprovalHash(nextVoiceScript);
      const approvalAlreadyCurrent =
        !voiceChanged &&
        existing.voice_script_approved_by === sender.userId &&
        existing.voice_script_approved_hash === approvalHash &&
        Boolean(existing.voice_script_approved_at);
      if (!approvalAlreadyCurrent) {
        patch.voice_script_approved_at = new Date().toISOString();
        patch.voice_script_approved_by = sender.userId;
        patch.voice_script_approved_hash = approvalHash;
        voiceApprovalRecorded = true;
      }
      if (existing.voice_status !== "ready" || voiceChanged)
        patch.voice_status = "script_ready";
      patch.voice_estimated_seconds = estimatedVoiceSeconds(nextVoiceScript);
      patch.voice_error = null;
    }
    if (body.status === "approved") {
      if (!/(not|won't|will not|do not).{0,20}follow up/i.test(nextBody)) return NextResponse.json({ error: "Keep the simple opt-out line before approving" }, { status: 400 });
      if (existing.voice_status === "generating")
        return NextResponse.json(
          { error: "Wait for the voice note to finish before approving" },
          { status: 409 }
        );
      if (
        nextVoiceScript &&
        (voiceChanged || existing.voice_status !== "ready")
      )
        return NextResponse.json(
          {
            error:
              "Generate and preview the personal voice note before approving this email",
          },
          { status: 409 }
        );
      patch.status = "approved";
      patch.approved_at = new Date().toISOString();
      // Approval covers the exact visible words. If those words changed, any
      // previous send slot is invalid and must be queued again deliberately.
      if (contentChanged) patch.scheduled_at = null;
    } else if (contentChanged && existing.status === "approved") {
      // Approval is for the exact words shown. Editing afterwards deliberately
      // returns the message to draft so changed copy cannot bypass review.
      patch.status = "draft";
      patch.approved_at = null;
      patch.scheduled_at = null;
    }
    if (body.status === "draft") { patch.status = "draft"; patch.approved_at = null; patch.scheduled_at = null; }
    const { data, error } = await supabaseAdmin
      .from("outreach_messages")
      .update(patch)
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    if (data.message_source !== "brain_direct") {
      const { data: enrolment, error: enrolmentError } = await supabaseAdmin
        .from("outreach_enrolments")
        .update({
          status: data.status === "approved" ? "approved" : "drafted",
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", sender.workspaceId)
        .eq("id", data.enrolment_id)
        .select("id, status")
        .maybeSingle();
      if (enrolmentError) throw enrolmentError;
      if (!enrolment)
        throw new Error("database did not confirm the campaign enrolment");
    }
    const events: Record<string, any>[] = [];
    if (voiceApprovalRecorded) {
      events.push({
        workspace_id: sender.workspaceId,
        owner_id: sender.userId,
        visibility: "team",
        campaign_id: data.campaign_id,
        prospect_id: data.prospect_id,
        message_id: data.id,
        kind: "voice_script_approved",
        metadata: {
          scriptHash: data.voice_script_approved_hash,
          estimatedSeconds: data.voice_estimated_seconds,
          estimatedCostGbp: voiceApprovalBudget?.estimatedCostGbp,
          maximumCostGbp: voiceApprovalBudget?.maximumCostGbp,
        },
      });
    }
    if (data.status === "approved") {
      events.push({
        workspace_id: sender.workspaceId,
        owner_id: sender.userId,
        visibility: "team",
        campaign_id: data.campaign_id,
        prospect_id: data.prospect_id,
        message_id: data.id,
        kind: "approved",
      });
    }
    if (events.length) {
      const { error: eventError } = await supabaseAdmin
        .from("outreach_events")
        .insert(events);
      if (eventError) throw eventError;
    }
    return NextResponse.json({
      message: data,
      ...(voiceApprovalBudget
        ? {
            voiceApproval: {
              estimatedCostGbp: voiceApprovalBudget.estimatedCostGbp,
              maximumCostGbp: voiceApprovalBudget.maximumCostGbp,
            },
          }
        : {}),
    });
  } catch (error: any) {
    const safetyMessage = outreachSafetyError(error);
    return NextResponse.json(
      { error: safetyMessage || error?.message || "failed to save draft" },
      {
        status: safetyMessage
          ? 409
          : error instanceof OutreachVoiceBudgetError
            ? error.status
            : 500,
      }
    );
  }
}
