import { NextRequest, NextResponse } from "next/server";

import {
  isManualOutreachSequenceStep,
  outreachSequenceStepAt,
  type OutreachSequenceActionType,
} from "@/lib/outreach-sequence";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clean = (value: unknown, max: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const body = await req.json().catch(() => ({}));
    const requestId = clean(body.requestId, 80);
    const enrolmentId = clean(body.enrolmentId, 80);
    const actionType = clean(body.actionType, 80) as OutreachSequenceActionType;
    const note = clean(body.note, 1000);
    if (!UUID.test(requestId) || !UUID.test(enrolmentId)) {
      return NextResponse.json(
        { error: "A valid manual action request is required" },
        { status: 400 }
      );
    }

    const { data: existingEvent, error: existingEventError } =
      await supabaseAdmin
        .from("outreach_events")
        .select("id,metadata,created_at")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .eq("kind", "approved")
        .contains("metadata", { requestId })
        .maybeSingle();
    if (existingEventError) throw existingEventError;
    if (existingEvent) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        event: existingEvent,
      });
    }

    const [{ data: prospect, error: prospectError }, { data: enrolment, error: enrolmentError }] =
      await Promise.all([
        supabaseAdmin
          .from("outreach_prospects")
          .select("id,status,last_reply_at,assigned_to_user_id")
          .eq("workspace_id", account.workspaceId)
          .eq("id", params.id)
          .maybeSingle(),
        supabaseAdmin
          .from("outreach_enrolments")
          .select("id,campaign_id,prospect_id,status,current_step,next_action_at")
          .eq("workspace_id", account.workspaceId)
          .eq("owner_id", account.userId)
          .eq("id", enrolmentId)
          .eq("prospect_id", params.id)
          .maybeSingle(),
      ]);
    if (prospectError) throw prospectError;
    if (enrolmentError) throw enrolmentError;
    if (!prospect || !enrolment) {
      return NextResponse.json(
        { error: "This sequence step is no longer available" },
        { status: 404 }
      );
    }
    if (prospect.assigned_to_user_id !== account.userId) {
      return NextResponse.json(
        { error: "This prospect is assigned to another team member" },
        { status: 403 }
      );
    }
    if (
      prospect.last_reply_at ||
      ["replied", "qualified", "not_interested", "suppressed"].includes(
        prospect.status
      ) ||
      ["replied", "booked", "completed", "suppressed", "paused"].includes(
        enrolment.status
      )
    ) {
      return NextResponse.json(
        { error: "This sequence has stopped because the prospect replied or is no longer eligible" },
        { status: 409 }
      );
    }
    if (
      enrolment.next_action_at &&
      new Date(enrolment.next_action_at).getTime() > Date.now()
    ) {
      return NextResponse.json(
        { error: "This sequence step is not due yet" },
        { status: 409 }
      );
    }

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("outreach_campaigns")
      .select("id,status,sequence")
      .eq("workspace_id", account.workspaceId)
      .eq("id", enrolment.campaign_id)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign || campaign.status !== "active") {
      return NextResponse.json(
        { error: "The campaign is not active" },
        { status: 409 }
      );
    }

    const currentStep = Number(enrolment.current_step) || 1;
    const step = outreachSequenceStepAt(campaign.sequence, currentStep);
    if (
      !isManualOutreachSequenceStep(step) ||
      step?.channel !== "linkedin" ||
      !step.actionType?.startsWith("linkedin_")
    ) {
      return NextResponse.json(
        { error: "This is not a manual LinkedIn step" },
        { status: 409 }
      );
    }
    if (step.actionType !== actionType) {
      return NextResponse.json(
        { error: "The sequence changed before this action was saved" },
        { status: 409 }
      );
    }

    const nextStepNumber = currentStep + 1;
    const nextStep = outreachSequenceStepAt(campaign.sequence, nextStepNumber);
    const completedAt = new Date();
    const nextActionAt = nextStep
      ? new Date(
          completedAt.getTime() + Math.max(1, nextStep.delayDays || 1) * 86400000
        ).toISOString()
      : null;
    const nextStatus = nextStep ? "contacted" : "completed";
    const updated = await supabaseAdmin
      .from("outreach_enrolments")
      .update({
        status: nextStatus,
        current_step: nextStep ? nextStepNumber : currentStep,
        next_action_at: nextActionAt,
        updated_at: completedAt.toISOString(),
      })
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("id", enrolment.id)
      .eq("prospect_id", prospect.id)
      .eq("current_step", currentStep)
      .in("status", ["queued", "contacted"])
      .select("id,status,current_step,next_action_at")
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) {
      return NextResponse.json(
        { error: "This sequence step was already changed in another window" },
        { status: 409 }
      );
    }

    if (["linkedin_connect", "linkedin_message"].includes(actionType)) {
      await supabaseAdmin
        .from("outreach_prospects")
        .update({
          status: "contacted",
          last_contacted_at: completedAt.toISOString(),
          updated_at: completedAt.toISOString(),
        })
        .eq("workspace_id", account.workspaceId)
        .eq("assigned_to_user_id", account.userId)
        .eq("id", prospect.id);
    }

    const event = await supabaseAdmin
      .from("outreach_events")
      .insert({
        workspace_id: account.workspaceId,
        owner_id: account.userId,
        visibility: "team",
        campaign_id: campaign.id,
        prospect_id: prospect.id,
        kind: "approved",
        metadata: {
          requestId,
          action: "manual_sequence_step_completed",
          channel: step.channel,
          actionType: step.actionType,
          step: currentStep,
          purpose: step.purpose,
          note: note || null,
          actorUserId: account.userId,
          completedAt: completedAt.toISOString(),
          nextActionAt,
        },
      })
      .select("id,metadata,created_at")
      .single();
    if (event.error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "manual sequence step advanced without audit event",
          enrolmentId,
          prospectId: prospect.id,
          requestId,
          error: event.error.message,
        })
      );
    }

    return NextResponse.json({
      ok: true,
      alreadyCompleted: false,
      enrolment: updated.data,
      event: event.data || null,
      auditLogged: !event.error,
      nextStep,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The manual sequence step was not saved" },
      { status: 500 }
    );
  }
}
