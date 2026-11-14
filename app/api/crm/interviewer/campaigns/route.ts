import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { parseCampaignInput } from "@/lib/interviewer/campaign-input";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function blocked(message: string, status = 400) {
  return NextResponse.json(
    crmBlockerPayload({
      code: "interviewer_campaign_blocked",
      title: "Campaign was not saved",
      reason: message,
      nextAction: "Correct the field mentioned above and try again. The previous campaign list is unchanged.",
      responsible: "owner",
      outcome: "No campaign was confirmed saved.",
    }),
    { status, headers: noStore }
  );
}

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
    const parsed = parseCampaignInput(body && typeof body === "object" ? body : {});
    if (!parsed.ok) return blocked(parsed.message);
    const value = parsed.value;
    const row = {
      name: value.name,
      voice_id: value.voiceId,
      max_minutes: value.maxMinutes,
      rate_per_minute: value.ratePerMinute,
      currency: value.currency,
      margin_percent: value.marginPercent,
      billing_granularity: value.billingGranularity,
      persona_override: value.personaOverride,
      prompt_override: value.promptOverride,
      updated_at: new Date().toISOString(),
    };
    const campaignId = typeof body?.id === "string" ? body.id : "";
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
    if (error) throw error;
    if (!data) return blocked("That campaign was not found for your account.", 404);
    return NextResponse.json({ campaign: data }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
