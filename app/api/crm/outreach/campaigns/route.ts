import { NextRequest, NextResponse } from "next/server";
import { sanitizeOutreachSequence } from "@/lib/outreach-sequence";
import { resolveOutreachCampaignSelection } from "@/lib/outreach-campaign-selection";
import { clampOutreachDailyLimit } from "@/lib/outreach-limits";
import { sanitizeOutreachCampaignCtaConfig } from "@/lib/outreach-demo-reply-cta";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type CampaignStats = {
  enrolled: number;
  contacted: number;
  emailsSent: number;
  linkedinSent: number;
  replies: number;
  interested: number;
  meetings: number;
  replyRate: number;
  meetingRate: number;
};

const emptyCampaignStats = (): CampaignStats => ({
  enrolled: 0,
  contacted: 0,
  emailsSent: 0,
  linkedinSent: 0,
  replies: 0,
  interested: 0,
  meetings: 0,
  replyRate: 0,
  meetingRate: 0,
});

async function loadPersonalCampaignStats(
  workspaceId: string,
  userId: string,
  campaignIds: string[]
) {
  const stats: Record<string, CampaignStats> = Object.fromEntries(
    campaignIds.map((id) => [id, emptyCampaignStats()])
  );
  if (!campaignIds.length) return stats;
  const [enrolments, messages, events] = await Promise.all([
    supabaseAdmin
      .from("outreach_enrolments")
      .select("campaign_id,prospect_id")
      .eq("workspace_id", workspaceId)
      .eq("owner_id", userId)
      .in("campaign_id", campaignIds),
    supabaseAdmin
      .from("outreach_messages")
      .select("id,campaign_id,prospect_id,status")
      .eq("workspace_id", workspaceId)
      .eq("sender_user_id", userId)
      .in("campaign_id", campaignIds),
    supabaseAdmin
      .from("outreach_events")
      .select("campaign_id,prospect_id,kind")
      .eq("workspace_id", workspaceId)
      .eq("owner_id", userId)
      .in("campaign_id", campaignIds)
      .in("kind", [
        "linkedin_connection_sent",
        "linkedin_message_sent",
        "reply",
        "positive_reply",
        "objection",
        "later",
        "referral",
        "unsubscribe",
        "meeting_booked",
      ]),
  ]);
  for (const result of [enrolments, messages, events]) {
    if (result.error) throw result.error;
  }

  for (const campaignId of campaignIds) {
    const enrolledProspects = new Set(
      (enrolments.data || [])
        .filter((row: any) => row.campaign_id === campaignId)
        .map((row: any) => row.prospect_id)
    );
    const sentMessages = (messages.data || []).filter(
      (row: any) => row.campaign_id === campaignId && row.status === "sent"
    );
    const contactedProspects = new Set(
      sentMessages.map((row: any) => row.prospect_id)
    );
    const campaignEvents = (events.data || []).filter(
      (row: any) => row.campaign_id === campaignId
    );
    const linkedInEvents = campaignEvents.filter((row: any) =>
      ["linkedin_connection_sent", "linkedin_message_sent"].includes(row.kind)
    );
    for (const row of linkedInEvents) contactedProspects.add(row.prospect_id);
    const replyProspects = new Set(
      campaignEvents
        .filter((row: any) =>
          ["reply", "positive_reply", "objection", "later", "referral", "unsubscribe"].includes(row.kind)
        )
        .map((row: any) => row.prospect_id)
    );
    const interestedProspects = new Set(
      campaignEvents
        .filter((row: any) =>
          ["positive_reply", "referral"].includes(row.kind)
        )
        .map((row: any) => row.prospect_id)
    );
    const meetingProspects = new Set(
      campaignEvents
        .filter((row: any) => row.kind === "meeting_booked")
        .map((row: any) => row.prospect_id)
    );
    const contacted = contactedProspects.size;
    stats[campaignId] = {
      enrolled: enrolledProspects.size,
      contacted,
      emailsSent: sentMessages.length,
      linkedinSent: linkedInEvents.length,
      replies: replyProspects.size,
      interested: interestedProspects.size,
      meetings: meetingProspects.size,
      replyRate: contacted
        ? Math.round((replyProspects.size / contacted) * 1000) / 10
        : 0,
      meetingRate: contacted
        ? Math.round((meetingProspects.size / contacted) * 1000) / 10
        : 0,
    };
  }
  return stats;
}

export async function GET(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const selection = await resolveOutreachCampaignSelection(
      account.userId,
      account.workspaceId
    );
    const includeStats = req.nextUrl.searchParams.get("stats") === "1";
    const campaignStats = includeStats
      ? await loadPersonalCampaignStats(
          account.workspaceId,
          account.userId,
          selection.campaigns.map((campaign: any) => campaign.id)
        )
      : undefined;
    return NextResponse.json({
      campaigns: selection.campaigns,
      ...(campaignStats ? { campaignStats, statsScope: "personal" } : {}),
      selectedCampaignId: selection.selectedCampaignId,
      canEditCampaignContent: account.status === "active",
      canManageCampaigns:
        account.status === "active" &&
        (account.role === "owner" || account.role === "manager"),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to load campaigns" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    if (account.role !== "owner" && account.role !== "manager") {
      return NextResponse.json(
        { error: "Only a workspace owner or manager can create campaigns" },
        { status: 403 }
      );
    }
    const body = await req.json();
    const name = String(body.name || "").trim();
    const goal = String(body.goal || "").trim();
    const audience = String(body.audience || "").trim();
    const offerAngle = String(body.offer_angle || "").trim();
    if (!name || !goal || !audience || !offerAngle) return NextResponse.json({ error: "Name, goal, audience and angle are required" }, { status: 400 });
    const sequenceResult = sanitizeOutreachSequence(body.sequence);
    if (sequenceResult.error) {
      return NextResponse.json(
        { error: sequenceResult.error },
        { status: 400 }
      );
    }
    const ctaResult = sanitizeOutreachCampaignCtaConfig(
      body.cta_config,
      "reply_demo"
    );
    if (ctaResult.error) {
      return NextResponse.json({ error: ctaResult.error }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from("outreach_campaigns").insert({
      name,
      goal,
      audience,
      offer_angle: offerAngle,
      daily_limit: clampOutreachDailyLimit(body.daily_limit),
      approval_mode: true,
      sequence: sequenceResult.sequence,
      cta_config: ctaResult.config,
      workspace_id: account.workspaceId,
      owner_id: account.userId,
      visibility: "team",
    }).select("*").single();
    if (error) throw error;
    return NextResponse.json({ campaign: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to create campaign" }, { status: 500 });
  }
}
