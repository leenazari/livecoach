import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { capitaliseSentenceStarts } from "@/lib/text";
import { getCommercialMemory } from "@/lib/commercial-memory";
import {
  CONTACT_METHODS,
  ENGAGEMENT_MOTIONS,
  PIPELINE_STAGES,
  WIN_OUTLOOKS,
  cleanStringList,
} from "@/lib/opportunity-fields";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { loadVisibleOpportunityById } from "@/lib/opportunity-access";

export const runtime = "nodejs";

// PATCH  /api/crm/opportunities/:id -> update status (open|won|lost|dismissed)
//        or edit title/detail/value.
// DELETE /api/crm/opportunities/:id
const STATUSES = ["open", "won", "lost", "dismissed"];
const OWNER_TYPES = ["us", "buyer", "joint"];
const FORECAST_CATEGORIES = ["pipeline", "best_case", "commit", "omitted"];
const OPPORTUNITY_TYPES = ["revenue", "investment", "internal", "strategic"];
const NEXT_ACTION_OWNERS = ["us", "buyer", "joint"];

const cleanClosePlan = (value: any) => {
  const targetCloseDate =
    typeof value?.targetCloseDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.targetCloseDate)
      ? value.targetCloseDate
      : null;
  const milestones = Array.isArray(value?.milestones)
    ? value.milestones
        .filter((m: any) => m && typeof m.label === "string" && m.label.trim())
        .slice(0, 20)
        .map((m: any) => ({
          id:
            typeof m.id === "string" && m.id.trim()
              ? m.id.trim().slice(0, 80)
              : crypto.randomUUID(),
          label: m.label.trim().slice(0, 200),
          owner: OWNER_TYPES.includes(m.owner) ? m.owner : "joint",
          dueAt:
            typeof m.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.dueAt)
              ? m.dueAt
              : null,
          status: m.status === "done" ? "done" : "pending",
        }))
    : [];
  return { targetCloseDate, milestones };
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const current = await loadVisibleOpportunityById<any>(account, params.id);
    if (!current)
      return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    if (
      account.role === "sales" &&
      current.assigned_to_user_id &&
      current.assigned_to_user_id !== account.userId
    ) {
      return NextResponse.json(
        { error: "This opportunity belongs to another salesperson and is view only" },
        { status: 403 }
      );
    }
    if (
      account.role === "sales" &&
      !current.assigned_to_user_id &&
      current.owner_id !== account.userId &&
      body.assignedToUserId !== account.userId
    ) {
      return NextResponse.json(
        { error: "Claim this unassigned opportunity before changing it" },
        { status: 409 }
      );
    }

    const patch: Record<string, any> = {};
    if (body.assignedToUserId === null || body.assignedToUserId === "") {
      if (
        account.role === "sales" &&
        current.assigned_to_user_id !== account.userId
      ) {
        return NextResponse.json({ error: "You can only release your own opportunity" }, { status: 403 });
      }
      patch.assigned_to_user_id = null;
    } else if (typeof body.assignedToUserId === "string") {
      const requested = body.assignedToUserId.trim();
      if (account.role === "sales" && requested !== account.userId)
        return NextResponse.json({ error: "You can only claim an opportunity for yourself" }, { status: 403 });
      const { data: assignee } = await supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", account.workspaceId)
        .eq("user_id", requested)
        .eq("status", "active")
        .maybeSingle();
      if (!assignee)
        return NextResponse.json({ error: "Choose an active team member" }, { status: 400 });
      patch.assigned_to_user_id = requested;
      // Assignment is the owner's explicit sharing decision for the pipeline
      // record only. The linked client, calls, emails and transcripts retain
      // their own visibility and are never promoted with it.
      if (requested !== current.owner_id) patch.visibility = "team";
    }
    if (typeof body.status === "string" && STATUSES.includes(body.status)) {
      patch.status = body.status;
    }
    if (typeof body.title === "string" && body.title.trim()) {
      patch.title = body.title.trim();
    }
    if (typeof body.detail === "string") patch.detail = body.detail.trim() || null;
    if (typeof body.value === "number") patch.value = body.value;
    if (body.value === null) patch.value = null;
    if (typeof body.pipelineStage === "string" && PIPELINE_STAGES.includes(body.pipelineStage as any)) {
      patch.pipeline_stage = body.pipelineStage;
    }
    if (body.probability != null) {
      const probability = Math.round(Number(body.probability));
      if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
        return NextResponse.json({ error: "probability must be between 0 and 100" }, { status: 400 });
      }
      patch.probability = probability;
    }
    if (typeof body.forecastCategory === "string" && FORECAST_CATEGORIES.includes(body.forecastCategory)) {
      patch.forecast_category = body.forecastCategory;
    }
    if (typeof body.opportunityType === "string" && OPPORTUNITY_TYPES.includes(body.opportunityType)) {
      if (
        body.opportunityType !== "revenue" &&
        current.owner_id !== account.userId &&
        account.role !== "owner"
      ) {
        return NextResponse.json(
          { error: "Only the record owner can classify private non-revenue work" },
          { status: 403 }
        );
      }
      patch.opportunity_type = body.opportunityType;
      if (body.opportunityType !== "revenue" && body.forecastCategory == null) {
        patch.forecast_category = "omitted";
      }
    }
    if (body.expectedCloseAt === null || body.expectedCloseAt === "") {
      patch.expected_close_at = null;
    } else if (typeof body.expectedCloseAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expectedCloseAt)) {
      patch.expected_close_at = body.expectedCloseAt;
    }
    if (typeof body.outcomeReason === "string") patch.outcome_reason = body.outcomeReason.trim().slice(0, 1000) || null;
    const sourceType = body.sourceType === "system" ? "system" : "human";
    const dealIntentRequested = Object.prototype.hasOwnProperty.call(body, "dealIntent");
    if (sourceType === "system" && current.deal_intent_override && dealIntentRequested) {
      return NextResponse.json(
        { error: "A human deal intent override is active. Clear it before applying a system intent." },
        { status: 409 }
      );
    }
    if (body.dealIntent === null || body.dealIntent === "") {
      patch.deal_intent = null;
    } else if (typeof body.dealIntent === "string") {
      patch.deal_intent = capitaliseSentenceStarts(body.dealIntent.trim()).slice(0, 1500) || null;
    }
    const changingDealIntent =
      dealIntentRequested &&
      patch.deal_intent !== undefined &&
      patch.deal_intent !== current.deal_intent;
    if (changingDealIntent) {
      patch.deal_intent_as_of = new Date().toISOString();
      patch.deal_intent_source = sourceType;
      if (sourceType === "human") {
        patch.deal_intent_override = true;
        patch.deal_intent_override_at = patch.deal_intent_as_of;
      }
    } else if (body.clearDealIntentOverride === true) {
      patch.deal_intent_override = false;
      patch.deal_intent_override_at = null;
    }
    if (body.engagementMotion === null || body.engagementMotion === "") {
      patch.engagement_motion = null;
    } else if (
      typeof body.engagementMotion === "string" &&
      ENGAGEMENT_MOTIONS.includes(body.engagementMotion as any)
    ) {
      patch.engagement_motion = body.engagementMotion;
    }
    if (body.activeContactMethod === null || body.activeContactMethod === "") {
      patch.active_contact_method = null;
    } else if (
      typeof body.activeContactMethod === "string" &&
      CONTACT_METHODS.includes(body.activeContactMethod as any)
    ) {
      patch.active_contact_method = body.activeContactMethod;
    }

    const outlookRequested =
      typeof body.winOutlook === "string" ||
      body.winOutlookConfidence !== undefined ||
      body.winOutlookReasons !== undefined ||
      body.winOutlookQuestions !== undefined;
    if (sourceType === "system" && current.win_outlook_override && outlookRequested) {
      return NextResponse.json(
        { error: "A human outlook override is active. Clear it before applying a system outlook." },
        { status: 409 }
      );
    }
    if (typeof body.winOutlook === "string") {
      if (!WIN_OUTLOOKS.includes(body.winOutlook as any)) {
        return NextResponse.json({ error: "win outlook is not valid" }, { status: 400 });
      }
      const resultingStage = patch.pipeline_stage || current.pipeline_stage;
      const resultingStatus = patch.status || current.status;
      if (body.winOutlook === "won" && resultingStage !== "won" && resultingStatus !== "won") {
        return NextResponse.json(
          { error: "Won outlook is only available when the opportunity lifecycle is won" },
          { status: 400 }
        );
      }
      patch.win_outlook = body.winOutlook;
    }
    if (body.winOutlookConfidence === null || body.winOutlookConfidence === "") {
      patch.win_outlook_confidence = null;
    } else if (body.winOutlookConfidence !== undefined) {
      const confidence = Math.round(Number(body.winOutlookConfidence));
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
        return NextResponse.json({ error: "outlook confidence must be between 0 and 100" }, { status: 400 });
      }
      patch.win_outlook_confidence = confidence;
    }
    if (body.winOutlookReasons !== undefined)
      patch.win_outlook_reasons = cleanStringList(body.winOutlookReasons);
    if (body.winOutlookQuestions !== undefined)
      patch.win_outlook_questions = cleanStringList(body.winOutlookQuestions, 6, 300);
    const changingOutlook =
      (patch.win_outlook !== undefined && patch.win_outlook !== current.win_outlook) ||
      (patch.win_outlook_confidence !== undefined && patch.win_outlook_confidence !== current.win_outlook_confidence) ||
      (patch.win_outlook_reasons !== undefined && JSON.stringify(patch.win_outlook_reasons) !== JSON.stringify(current.win_outlook_reasons || [])) ||
      (patch.win_outlook_questions !== undefined && JSON.stringify(patch.win_outlook_questions) !== JSON.stringify(current.win_outlook_questions || []));
    if (changingOutlook) {
      patch.win_outlook_as_of = new Date().toISOString();
      patch.win_outlook_source = sourceType;
      if (sourceType === "human") {
        patch.win_outlook_override = true;
        patch.win_outlook_override_at = patch.win_outlook_as_of;
      }
    }
    if (body.clearWinOutlookOverride === true) {
      patch.win_outlook_override = false;
      patch.win_outlook_override_at = null;
    }
    if (body.nextAction === null || body.nextAction === "") {
      patch.next_action = null;
    } else if (typeof body.nextAction === "string") {
      patch.next_action = capitaliseSentenceStarts(body.nextAction.trim()).slice(0, 500) || null;
    }
    if (body.nextActionDueAt === null || body.nextActionDueAt === "") {
      patch.next_action_due_at = null;
    } else if (
      typeof body.nextActionDueAt === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.nextActionDueAt)
    ) {
      patch.next_action_due_at = `${body.nextActionDueAt}T12:00:00Z`;
    }
    if (
      typeof body.nextActionOwner === "string" &&
      NEXT_ACTION_OWNERS.includes(body.nextActionOwner)
    ) {
      patch.next_action_owner = body.nextActionOwner;
    }
    const manualStageChange =
      sourceType === "human" &&
      patch.pipeline_stage !== undefined &&
      patch.pipeline_stage !== current.pipeline_stage;
    const manualNextActionChange =
      sourceType === "human" &&
      ((patch.next_action !== undefined &&
        patch.next_action !== current.next_action) ||
        (patch.next_action_due_at !== undefined &&
          patch.next_action_due_at !== current.next_action_due_at) ||
        (patch.next_action_owner !== undefined &&
          patch.next_action_owner !== current.next_action_owner));
    if (manualStageChange) {
      patch.pipeline_stage_override = true;
      patch.pipeline_stage_override_at = new Date().toISOString();
    } else if (body.clearPipelineStageOverride === true) {
      patch.pipeline_stage_override = false;
      patch.pipeline_stage_override_at = null;
    }
    if (manualNextActionChange) {
      patch.next_action_override = true;
      patch.next_action_override_at = new Date().toISOString();
    } else if (body.clearNextActionOverride === true) {
      patch.next_action_override = false;
      patch.next_action_override_at = null;
    }
    if (body.closePlan && typeof body.closePlan === "object") {
      patch.close_plan = cleanClosePlan(body.closePlan);
    }
    const resultingOpportunityType =
      patch.opportunity_type || current.opportunity_type || "revenue";
    if (resultingOpportunityType !== "revenue") {
      patch.visibility = "private";
      patch.assigned_to_user_id = current.owner_id;
      patch.forecast_category = "omitted";
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();
    if (patch.status === "won") {
      patch.pipeline_stage = "won";
      patch.probability = 100;
      patch.forecast_category = "commit";
      patch.won_at = patch.updated_at;
      patch.lost_at = null;
      patch.win_outlook = "won";
      patch.win_outlook_confidence = 100;
      patch.win_outlook_reasons = ["Opportunity marked won"];
      patch.win_outlook_as_of = patch.updated_at;
      patch.win_outlook_source = sourceType;
    } else if (patch.status === "lost") {
      patch.pipeline_stage = "lost";
      patch.probability = 0;
      patch.forecast_category = "omitted";
      patch.lost_at = patch.updated_at;
      patch.won_at = null;
    } else if (patch.status === "open") {
      patch.won_at = null;
      patch.lost_at = null;
    }
    patch.last_change_context = {
      nonce: crypto.randomUUID(),
      sourceType,
      sourceChannel:
        typeof body.sourceChannel === "string" && body.sourceChannel.trim()
          ? body.sourceChannel.trim().slice(0, 80)
          : "pipeline_dashboard",
      rationale:
        typeof body.rationale === "string" && body.rationale.trim()
          ? body.rationale.trim().slice(0, 1000)
          : sourceType === "human"
            ? "Confirmed by the user"
            : "Updated from stored CRM evidence",
      evidence:
        body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)
          ? body.evidence
          : {},
    };
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .update(patch)
      .eq("workspace_id", account.workspaceId)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    // Opportunity fields are duplicated into the compact commercial memory
    // used by Brain and call prep. Refresh it now so a saved probability or
    // next action cannot remain stale until another call is processed.
    if (data?.company_id && data.owner_id === account.userId)
      await getCommercialMemory(data.company_id, data.workstream_id || null);
    return NextResponse.json({ opportunity: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update opportunity" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const current = await loadVisibleOpportunityById<any>(
      account,
      params.id,
      "id,workspace_id,owner_id,visibility,opportunity_type,assigned_to_user_id,company_id"
    );
    if (!current)
      return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    if (account.role === "sales" && current.owner_id !== account.userId) {
      return NextResponse.json(
        { error: "Shared opportunities should be closed or dismissed, not deleted" },
        { status: 403 }
      );
    }
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .delete()
      .eq("workspace_id", account.workspaceId)
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete opportunity" },
      { status: 500 }
    );
  }
}
