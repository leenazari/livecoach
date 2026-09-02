import { NextRequest, NextResponse } from "next/server";

import {
  effectiveOutreachCtaConfig,
  sanitizeOutreachCampaignCtaConfig,
  type OutreachCampaignCtaConfig,
} from "@/lib/outreach-demo-reply-cta";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    if (!UUID.test(params.id)) {
      return NextResponse.json({ error: "Outreach item not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    if (!Object.prototype.hasOwnProperty.call(body, "ctaConfig")) {
      return NextResponse.json(
        { error: "Choose a call to action" },
        { status: 400 }
      );
    }

    let ctaConfig: OutreachCampaignCtaConfig | null = null;
    if (body.ctaConfig !== null) {
      const validated = sanitizeOutreachCampaignCtaConfig(
        body.ctaConfig,
        "auto"
      );
      if (validated.error) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      // Person level "auto" is represented by null so it always inherits the
      // latest campaign recommendation rather than copying a stale default.
      ctaConfig = validated.config.type === "auto" ? null : validated.config;
    }

    const { data: enrolment, error: enrolmentError } = await supabaseAdmin
      .from("outreach_enrolments")
      .select("id,campaign_id,prospect_id,owner_id,visibility,cta_config,current_step,status")
      .eq("workspace_id", account.workspaceId)
      .eq("id", params.id)
      .maybeSingle();
    if (enrolmentError) throw enrolmentError;
    if (!enrolment) {
      return NextResponse.json({ error: "Outreach item not found" }, { status: 404 });
    }

    const [
      { data: prospect, error: prospectError },
      { data: campaign, error: campaignError },
    ] = await Promise.all([
      supabaseAdmin
        .from("outreach_prospects")
        .select("id,assigned_to_user_id")
        .eq("workspace_id", account.workspaceId)
        .eq("id", enrolment.prospect_id)
        .maybeSingle(),
      supabaseAdmin
        .from("outreach_campaigns")
        .select("id,cta_config")
        .eq("workspace_id", account.workspaceId)
        .eq("id", enrolment.campaign_id)
        .maybeSingle(),
    ]);
    if (prospectError) throw prospectError;
    if (campaignError) throw campaignError;
    if (
      !prospect ||
      !campaign ||
      prospect.assigned_to_user_id !== account.userId
    ) {
      return NextResponse.json(
        { error: "This prospect is not assigned to your account" },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("outreach_enrolments")
      .update({ cta_config: ctaConfig, updated_at: now })
      .eq("workspace_id", account.workspaceId)
      .eq("prospect_id", prospect.id)
      .eq("id", enrolment.id)
      .select("id,cta_config,updated_at")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json(
        { error: "The call to action was not saved" },
        { status: 409 }
      );
    }

    const effective = effectiveOutreachCtaConfig({
      enrolmentCtaConfig: updated.cta_config,
      campaignCtaConfig: campaign.cta_config,
    });
    const { data: draft } = await supabaseAdmin
      .from("outreach_messages")
      .select("id,status,step_number")
      .eq("workspace_id", account.workspaceId)
      .eq("sender_user_id", account.userId)
      .eq("enrolment_id", enrolment.id)
      .eq("step_number", Number(enrolment.current_step) || 1)
      .maybeSingle();

    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: account.workspaceId,
        actor_user_id: account.userId,
        source: "human",
        action: ctaConfig
          ? "outreach_prospect_cta_overridden"
          : "outreach_prospect_cta_inherited",
        target_table: "outreach_enrolments",
        target_id: enrolment.id,
        previous_scope: {
          ownerId: enrolment.owner_id,
          visibility: enrolment.visibility,
        },
        next_scope: {
          ownerId: enrolment.owner_id,
          visibility: enrolment.visibility,
        },
        metadata: {
          ctaType: effective.config.type,
          inherited: effective.inherited,
        },
      });
    if (auditError) {
      console.error("Prospect CTA audit failed", auditError.message);
    }

    return NextResponse.json({
      enrolment: updated,
      effectiveCtaConfig: effective.config,
      inherited: effective.inherited,
      draftNeedsRefresh: Boolean(
        draft && ["draft", "failed"].includes(draft.status)
      ),
      lockedHistoricalMessage: Boolean(
        draft && ["approved", "sending", "sent"].includes(draft.status)
      ),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to save the call to action" },
      { status: 500 }
    );
  }
}
