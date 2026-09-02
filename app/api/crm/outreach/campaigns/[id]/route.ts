import { NextRequest, NextResponse } from "next/server";
import { clampOutreachDailyLimit } from "@/lib/outreach-limits";
import { sanitizeOutreachSequence } from "@/lib/outreach-sequence";
import { sanitizeOutreachCampaignCtaConfig } from "@/lib/outreach-demo-reply-cta";
import {
  OUTREACH_CAMPAIGN_CONTENT_FIELDS,
  OUTREACH_CAMPAIGN_CONTROL_FIELDS,
  outreachCampaignPermissions,
} from "@/lib/outreach-campaign-permissions";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const account = requireRequestScope();
    const { data: current, error: currentError } = await supabaseAdmin
      .from("outreach_campaigns")
      .select("*")
      .eq("workspace_id", account.workspaceId)
      .eq("id", params.id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const permissions = outreachCampaignPermissions({
      role: account.role,
      memberStatus: account.status,
      campaignVisibility: current.visibility,
    });
    if (!permissions.canEditCampaignContent) {
      return NextResponse.json(
        { error: "This campaign is not shared with your sales account" },
        { status: 403 }
      );
    }
    const body = await req.json();
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of ["goal", "audience", "offer_angle"]) {
      if (typeof body[key] === "string" && body[key].trim()) {
        patch[key] = body[key].trim();
      }
    }
    if (Array.isArray(body.sequence)) {
      const result = sanitizeOutreachSequence(body.sequence);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      patch.sequence = result.sequence;
    }
    if (Object.prototype.hasOwnProperty.call(body, "cta_config")) {
      const result = sanitizeOutreachCampaignCtaConfig(body.cta_config, "auto");
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      patch.cta_config = result.config;
    }
    if (body.voice && typeof body.voice === "object") {
      // This legacy field describes campaign writing only. Keep an explicit
      // allowlist so a campaign can never store or override a salesperson's
      // ElevenLabs audio voice.
      patch.voice = {
        tone: String(body.voice.tone || "warm, commercially curious and concise").trim().slice(0, 300),
        style: String(body.voice.style || "founder-to-founder, plain English and respectful").trim().slice(0, 500),
        rules: Array.isArray(body.voice.rules) ? body.voice.rules.map((rule: any) => String(rule).trim().slice(0, 240)).filter(Boolean).slice(0, 12) : [],
      };
    }
    if (Array.isArray(body.banned_phrases)) {
      patch.banned_phrases = body.banned_phrases.map((phrase: any) => String(phrase).trim().toLowerCase().slice(0, 100)).filter(Boolean).slice(0, 30);
    }
    // Campaign booking links are legacy data and are never written or used.
    // Each salesperson owns their link in My Sales Setup.
    if (["interested_reply", "final_step", "always", "never"].includes(body.booking_cta_mode)) patch.booking_cta_mode = body.booking_cta_mode;
    if (permissions.canManageCampaign) {
      if (typeof body.name === "string" && body.name.trim()) {
        patch.name = body.name.trim();
      }
      if (["draft", "active", "paused", "completed"].includes(body.status)) {
        patch.status = body.status;
      }
      if (body.daily_limit != null) {
        patch.daily_limit = clampOutreachDailyLimit(body.daily_limit);
      }
    }
    // Approval mode is deliberately locked on for this first safe release.
    patch.approval_mode = true;
    let update = supabaseAdmin
      .from("outreach_campaigns")
      .update(patch)
      .eq("workspace_id", account.workspaceId)
      .eq("id", params.id);
    // A sales user may change shared copy and sequence only. Recheck the
    // visibility in the write itself so a simultaneous privacy change fails
    // closed rather than racing the permission lookup above.
    if (!permissions.canManageCampaign) update = update.eq("visibility", "team");
    const { data, error } = await update
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const changedFields = [
      ...OUTREACH_CAMPAIGN_CONTENT_FIELDS,
      ...(permissions.canManageCampaign ? OUTREACH_CAMPAIGN_CONTROL_FIELDS : []),
    ].filter((field) => field in patch);
    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: account.workspaceId,
        actor_user_id: account.userId,
        source: "human",
        action: permissions.canManageCampaign
          ? "outreach_campaign_updated"
          : "shared_outreach_campaign_content_updated",
        target_table: "outreach_campaigns",
        target_id: data.id,
        previous_scope: {
          ownerId: current.owner_id,
          visibility: current.visibility,
        },
        next_scope: {
          ownerId: data.owner_id,
          visibility: data.visibility,
        },
        metadata: {
          fields: changedFields,
          actorRole: account.role,
        },
      });
    if (auditError) {
      console.error("Campaign edit audit failed", auditError.message);
    }
    return NextResponse.json({
      campaign: data,
      permissions: {
        canEditCampaignContent: permissions.canEditCampaignContent,
        canManageCampaign: permissions.canManageCampaign,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to update campaign" }, { status: 500 });
  }
}
