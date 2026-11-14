import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { validateBillingFields, validateCampaignFields } from "@/lib/interviewer/form-fields";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const scope = await requireInterviewerOwner();
    const { data, error } = await supabaseAdmin
      .from("interviewer_campaigns")
      .select("id, name, voice_id, max_minutes, rate_per_minute, currency, margin_percent, billing_granularity, persona_override, prompt_override, created_at")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ campaigns: data || [] }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const campaignId = typeof record.id === "string" ? record.id : "";

    if (record.billingOnly === true) {
      const billing = validateBillingFields({
        ratePerMinute: String(record.ratePerMinute ?? ""),
        currency: String(record.currency ?? ""),
        marginPercent: String(record.marginPercent ?? ""),
        billingGranularity: String(record.billingGranularity ?? ""),
      });
      if (!campaignId) billing.fields.campaignId = "Pick a campaign.";
      if (Object.keys(billing.fields).length || !billing.currency || !billing.billingGranularity) {
        return interviewerFieldError("interviewer_billing_blocked", "Billing was not saved", billing.fields);
      }
      const { data, error } = await supabaseAdmin
        .from("interviewer_campaigns")
        .update({
          rate_per_minute: billing.ratePerMinute,
          currency: billing.currency,
          margin_percent: billing.marginPercent,
          billing_granularity: billing.billingGranularity,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .select("id, name, voice_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return interviewerFieldError("interviewer_billing_missing", "Billing was not saved", { campaignId: "That campaign was not found on your account." });
      return NextResponse.json({ campaign: data }, { headers: noStore });
    }

    const parsed = validateCampaignFields({
      name: String(record.name || ""),
      voiceId: String(record.voiceId || ""),
      maxMinutes: record.maxMinutes == null ? "" : String(record.maxMinutes),
    });
    if (Object.keys(parsed.fields).length || !parsed.voiceId) {
      return interviewerFieldError("interviewer_campaign_blocked", "Campaign was not saved", parsed.fields);
    }
    const row = {
      name: parsed.name,
      voice_id: parsed.voiceId,
      max_minutes: parsed.maxMinutes,
      updated_at: new Date().toISOString(),
    };
    const query = campaignId
      ? supabaseAdmin
          .from("interviewer_campaigns")
          .update(row)
          .eq("id", campaignId)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .select("id, name, voice_id")
          .maybeSingle()
      : supabaseAdmin
          .from("interviewer_campaigns")
          .insert({ ...row, workspace_id: scope.workspaceId, owner_id: scope.userId })
          .select("id, name, voice_id")
          .single();
    const { data, error } = await query;
    if (error && /voice_id_check|check constraint/i.test(error.message || "")) {
      return interviewerFieldError("interviewer_voice_not_ready", "Campaign was not saved", {
        voiceId: "That British voice is not allowed in this database yet. Draco and Pandora can be saved now. Helios and Athena need the new voice migration.",
      });
    }
    if (error) throw error;
    if (!data) return interviewerFieldError("interviewer_campaign_missing", "Campaign was not saved", { name: "That campaign was not found on your account." });
    return NextResponse.json({ campaign: data }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
