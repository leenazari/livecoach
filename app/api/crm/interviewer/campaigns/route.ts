import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { validateBillingFields, validateCampaignFields } from "@/lib/interviewer/form-fields";
import { loadOwnerBookingUrl } from "@/lib/interviewer/owner-booking";
import { PUBLIC_CALLS_OFF, PUBLIC_CALLS_TITLE } from "@/lib/interviewer/public-campaign";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const scope = await requireInterviewerOwner();
    const base = "id, name, voice_id, max_minutes, rate_per_minute, currency, margin_percent, billing_granularity, persona_override, prompt_override, created_at";
    const extra = `${base}, website_url, website_scraped_at, quotes_allowed, brochure_send, opener`;
    const rich = await supabaseAdmin
      .from("interviewer_campaigns")
      .select(extra)
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false });
    const bookingUrl = await loadOwnerBookingUrl(scope.userId, scope.workspaceId);
    if (!rich.error) return NextResponse.json({ campaigns: rich.data || [], bookingUrl }, { headers: noStore });
    if (!/column|schema cache/i.test(rich.error.message || "")) throw rich.error;
    const plain = await supabaseAdmin
      .from("interviewer_campaigns")
      .select(base)
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false });
    if (plain.error) throw plain.error;
    return NextResponse.json({ campaigns: plain.data || [], bookingUrl }, { headers: noStore });
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

    if (record.publicCallsOnly === true) {
      if (!campaignId) return interviewerFieldError("interviewer_public_calls_blocked", "Public calls were not changed", { campaignId: "Pick a campaign." });
      const owned = await supabaseAdmin
        .from("interviewer_campaigns")
        .select("id, workspace_id")
        .eq("id", campaignId)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) return interviewerFieldError("interviewer_public_calls_missing", "Public calls were not changed", { campaignId: "That campaign was not found on your account." });
      const removed = await supabaseAdmin
        .from("interviewer_documents")
        .delete()
        .eq("campaign_id", campaignId)
        .eq("workspace_id", scope.workspaceId)
        .eq("title", PUBLIC_CALLS_TITLE);
      if (removed.error) throw removed.error;
      if (record.acceptingCalls === false) {
        const inserted = await supabaseAdmin.from("interviewer_documents").insert({
          workspace_id: scope.workspaceId,
          campaign_id: campaignId,
          title: PUBLIC_CALLS_TITLE,
          body: PUBLIC_CALLS_OFF,
        });
        if (inserted.error) throw inserted.error;
      }
      return NextResponse.json({ saved: true, acceptingCalls: record.acceptingCalls !== false }, { headers: noStore });
    }

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

    if (record.behaviourOnly === true) {
      if (!campaignId) return interviewerFieldError("interviewer_behaviour_blocked", "Agent settings were not saved", { campaignId: "Pick a campaign." });
      const opener = String(record.opener || "").trim().slice(0, 400);
      const patch = {
        quotes_allowed: record.quotesAllowed === true,
        brochure_send: record.brochureSend === true,
        opener: opener || null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabaseAdmin
        .from("interviewer_campaigns")
        .update(patch)
        .eq("id", campaignId)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .select("id")
        .maybeSingle();
      if (error && /column|schema cache/i.test(error.message || "")) {
        return NextResponse.json({ saved: false, ready: false, note: "Agent switches need the new migration before they can be stored." }, { headers: noStore });
      }
      if (error) throw error;
      if (!data) return interviewerFieldError("interviewer_behaviour_missing", "Agent settings were not saved", { campaignId: "That campaign was not found on your account." });
      return NextResponse.json({ saved: true, ready: true }, { headers: noStore });
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
        voiceId: "You can preview every Aura voice. Saving one other than Draco or Pandora needs the voice migration, which has not been applied.",
      });
    }
    if (error) throw error;
    if (!data) return interviewerFieldError("interviewer_campaign_missing", "Campaign was not saved", { name: "That campaign was not found on your account." });
    return NextResponse.json({ campaign: data }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
