import { interviewerJson, interviewerPublicError } from "@/lib/interviewer/http";
import { loadPublicCampaignCard } from "@/lib/interviewer/public-campaign-data";
import {
  PUBLIC_CAMPAIGN_LIMIT,
  PUBLIC_CAMPAIGN_WINDOW_MS,
  PUBLIC_EMAIL_LIMIT,
  PUBLIC_EMAIL_WINDOW_MS,
  PUBLIC_INVITE_HOURS,
  PUBLIC_IP_LIMIT,
  PUBLIC_IP_WINDOW_MS,
  allowPublicJoin,
  clientAddress,
  honeypotTripped,
  isCampaignToken,
  validatePublicLead,
} from "@/lib/interviewer/public-campaign";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (honeypotTripped(record.company_fax)) {
      return interviewerJson({ started: false, error: "This campaign is not taking calls right now." });
    }
    const campaignId = String(record.campaignId || "");
    if (!isCampaignToken(campaignId)) {
      return interviewerJson({ started: false, error: "This link is not available." }, 404);
    }
    const lead = validatePublicLead({
      name: String(record.prospectName || ""),
      email: String(record.prospectEmail || ""),
    });
    if (Object.keys(lead.fields).length) {
      return interviewerJson({
        started: false,
        error: "Check your name and email. Nothing was started.",
        fields: lead.fields,
      }, 400);
    }
    const card = await loadPublicCampaignCard(campaignId);
    if (!card) return interviewerJson({ started: false, error: "This link is not available." }, 404);
    if (!card.accepting) {
      return interviewerJson({ started: false, error: "This campaign is not taking calls right now." }, 409);
    }
    const address = clientAddress(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip"));
    if (!allowPublicJoin(`ip:${address || "missing"}`, PUBLIC_IP_LIMIT, PUBLIC_IP_WINDOW_MS)) {
      return interviewerJson({
        started: false,
        error: "Too many calls were started from this network. Wait a few minutes. Nothing new was started.",
      }, 429);
    }
    const sinceEmail = new Date(Date.now() - PUBLIC_EMAIL_WINDOW_MS).toISOString();
    const sinceCampaign = new Date(Date.now() - PUBLIC_CAMPAIGN_WINDOW_MS).toISOString();
    const [emailCount, campaignCount] = await Promise.all([
      supabaseService
        .from("interviewer_invites")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", card.id)
        .eq("prospect_email", lead.email)
        .gte("created_at", sinceEmail),
      supabaseService
        .from("interviewer_invites")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", card.id)
        .gte("created_at", sinceCampaign),
    ]);
    if (emailCount.error || campaignCount.error) {
      return interviewerJson({
        started: false,
        error: "The call was not started. Nothing was saved. Wait a moment, then try again once.",
      }, 503);
    }
    if ((emailCount.count || 0) >= PUBLIC_EMAIL_LIMIT || (campaignCount.count || 0) >= PUBLIC_CAMPAIGN_LIMIT) {
      return interviewerJson({
        started: false,
        error: "Too many calls were started recently. Wait a while before another one. Nothing new was started.",
      }, 429);
    }
    const expiresAt = new Date(Date.now() + PUBLIC_INVITE_HOURS * 3600_000).toISOString();
    const inserted = await supabaseService
      .from("interviewer_invites")
      .insert({
        workspace_id: card.workspaceId,
        campaign_id: card.id,
        prospect_name: lead.name,
        prospect_email: lead.email,
        expires_at: expiresAt,
        created_by: card.ownerId,
      })
      .select("token")
      .single();
    if (inserted.error || !inserted.data?.token) {
      return interviewerJson({
        started: false,
        error: "The call was not started. Nothing was saved. Check your name and email, then try again.",
      }, 503);
    }
    return interviewerJson({
      started: true,
      path: `/i/${inserted.data.token}`,
      maxMinutes: card.maxMinutes,
    });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
