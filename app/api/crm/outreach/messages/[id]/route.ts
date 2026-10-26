import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { crmBlockerPayload, crmFallbackBlockerPayload } from "@/lib/crm-blocker";
import { supabaseAdmin } from "@/lib/supabase";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import { ensureOutreachEmailSimpleOptOut } from "@/lib/outreach-demo-reply-cta";
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
import { outreachVoiceHasFalseSenderIdentity } from "@/lib/outreach-voice-policy";
import { getOptionalSalesProfile } from "@/lib/sales-profile";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let stage: "checking" | "loading" | "saving" | "campaign" | "history" = "checking";
  let draftSaved = false;
  let alreadyQueued = false;
  let approvingVoice = false;
  try {
    const sender = await resolveOutreachIdentity();
    const personalProfile = await getOptionalSalesProfile({
      userId: sender.userId,
      workspaceId: sender.workspaceId,
    });
    const body = await req.json();
    stage = "loading";
    const { data: existing, error: readError } = await supabaseAdmin
      .from("outreach_messages")
      .select("*")
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (readError) throw readError;
    stage = "checking";
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
    const nextBody = ensureOutreachEmailSimpleOptOut({
      body: typeof body.body_text === "string" && body.body_text.trim()
        ? removeDashesFromProse(body.body_text.trim())
        : removeDashesFromProse(existing.body_text),
      signoff:
        personalProfile.emailSignoff || sender.senderName.split(" ")[0],
      maximumCharacters: 4000,
    });
    const nextVoiceScript = typeof body.voice_script === "string"
      ? normaliseOutreachVoiceScript(body.voice_script)
      : normaliseOutreachVoiceScript(existing.voice_script);
    const voiceChanged = nextVoiceScript !== normaliseOutreachVoiceScript(existing.voice_script);
    const contentChanged =
      nextSubject !== existing.subject ||
      nextBody !== existing.body_text ||
      voiceChanged;
    const voiceApprovalRequested = body.approve_voice_script === true;
    approvingVoice = voiceApprovalRequested;
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
      if (outreachVoiceHasFalseSenderIdentity(nextVoiceScript, sender.senderName))
        return NextResponse.json(
          {
            error:
              "The shared voice cannot claim to be the salesperson. Use We are Interviewa instead.",
          },
          { status: 400 }
        );
      const requiredWhyNow = normaliseOutreachVoiceScript(
        existing.strategy?.voiceUrgency?.whyNow
      );
      if (
        requiredWhyNow &&
        !nextVoiceScript.toLocaleLowerCase("en-GB").includes(
          requiredWhyNow.toLocaleLowerCase("en-GB")
        )
      )
        return NextResponse.json(
          {
            error:
              "Keep the approved why now sentence in the voice pitch, or prepare the draft again",
          },
          { status: 400 }
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
      patch.voice_character_count = voiceApprovalBudget.characters;
      patch.voice_estimated_cost_gbp = voiceApprovalBudget.estimatedCostGbp;
      patch.voice_error = null;
    }
    if (body.status === "approved") {
      if (!/(not|won't|will not|do not).{0,20}follow up/i.test(nextBody)) return NextResponse.json({ error: "Keep the simple opt-out line before approving" }, { status: 400 });
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
    stage = "saving";
    const { data, error } = await supabaseAdmin
      .from("outreach_messages")
      .update(patch)
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    if (!data) throw new Error("Draft save was not confirmed");
    draftSaved = true;
    alreadyQueued = data.status === "approved" && Boolean(data.scheduled_at);
    if (data.message_source !== "brain_direct") {
      stage = "campaign";
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
    const events: Array<{
      workspace_id: string;
      owner_id: string;
      visibility: "team";
      campaign_id: string | null;
      prospect_id: string;
      message_id: string;
      kind: "voice_script_approved" | "approved";
      metadata: Record<string, unknown>;
    }> = [];
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
          targetCostGbp: voiceApprovalBudget?.targetCostGbp,
          maximumCostGbp: voiceApprovalBudget?.maximumCostGbp,
          withinPreferredWordRange:
            voiceApprovalBudget?.withinPreferredWordRange,
          overTargetCost: voiceApprovalBudget?.overTargetCost,
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
        // Bulk inserts use the union of row columns. Omitting this when the
        // voice approval row has metadata inserts NULL, not the DB default.
        metadata: {},
      });
    }
    if (events.length) {
      stage = "history";
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
              targetCostGbp: voiceApprovalBudget.targetCostGbp,
              maximumCostGbp: voiceApprovalBudget.maximumCostGbp,
              withinPreferredWordRange:
                voiceApprovalBudget.withinPreferredWordRange,
              overTargetCost: voiceApprovalBudget.overTargetCost,
            },
          }
        : {}),
    });
  } catch (error: any) {
    const safetyMessage = outreachSafetyError(error);
    const status = safetyMessage ? 409
      : error instanceof OutreachVoiceBudgetError ? error.status : 500;
    const reference = randomUUID();
    // Safe correlation only. Never log draft text, recipients, credentials,
    // database error messages or the contents of another user's records.
    if (status >= 500 || draftSaved) {
      const code = String(error?.code || "");
      console.error("outreach_draft_save_failed", {
        reference, stage, draftSaved,
        code: /^[A-Z0-9_]{1,32}$/.test(code) ? code : "request_failed",
      });
    }
    if (draftSaved) {
      return NextResponse.json(crmBlockerPayload({
        code: `outreach_draft_${stage}_incomplete`,
        title: "Draft saved, but a follow-up step failed",
        reason: stage === "history"
          ? "The activity history could not be updated"
          : "The campaign could not be updated to match the saved draft",
        outcome: [
          "Your draft changes were saved",
          approvingVoice ? "The voice-script choice was saved, but this step did not generate audio" : "",
          alreadyQueued ? "The email is still queued and may send at its scheduled time" : "",
        ].filter(Boolean).join(". "),
        nextAction: "Reopen the draft and check Activity and its send status before continuing. Do not send another copy if it is already queued or sent. Share the support reference with a workspace owner",
        responsible: "system",
        reference,
      }), { status: 500 });
    }
    if (stage === "loading" && status >= 500) {
      return NextResponse.json(crmBlockerPayload({
        code: "outreach_draft_load_failed",
        title: "Email draft could not be opened for editing",
        reason: "LiveCoach could not load the draft and sender settings needed to check this edit",
        outcome: "This request stopped before changing the draft",
        nextAction: "Keep your text and reopen the draft. If it still fails, share the support reference with a workspace owner",
        responsible: "system",
        reference,
      }), { status: 500 });
    }
    const fallback = crmFallbackBlockerPayload({
      status, url: `/api/crm/outreach/messages/${params.id}`, method: "PATCH",
      serverMessage: safetyMessage || (error instanceof Error ? error.message : undefined),
    });
    return NextResponse.json(
      crmBlockerPayload({ ...fallback.blocker, reference }),
      { status }
    );
  }
}
