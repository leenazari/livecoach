import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { outreachCrmGuard } from "@/lib/outreach";
import { scoreOutreachProspect } from "@/lib/outreach-scoring";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { isActiveOutreachEnrolmentStatus } from "@/lib/outreach-team-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const priority = req.nextUrl.searchParams.get("priority") || "all";
    const status = req.nextUrl.searchParams.get("status") || "all";
    let query = supabaseAdmin
      .from("outreach_prospects")
      .select("*")
      .order("priority_score", { ascending: false })
      .order("company_name", { ascending: true })
      .limit(1000);
    if (["high", "medium", "low"].includes(priority)) query = query.eq("priority", priority);
    if (status !== "all") query = query.eq("status", status);
    const contextPromise = Promise.all([
      supabaseAdmin.from("outreach_campaigns").select("*").order("created_at"),
      supabaseAdmin.from("outreach_learnings").select("*").eq("status", "promoted").limit(100),
      supabaseAdmin.from("outreach_suppressions").select("target"),
      outreachCrmGuard(),
    ]);
    const historyPromise = Promise.all([
      supabaseAdmin
        .from("outreach_messages")
        .select("id,prospect_id,status,subject,step_number,scheduled_at,sent_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from("outreach_enrolments")
        .select("campaign_id,prospect_id,status,current_step,last_sent_at,next_action_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(2000),
    ]);
    const [{ data, error }, context, history] = await Promise.all([
      query,
      contextPromise,
      historyPromise,
    ]);
    if (error) throw error;
    const [{ data: campaigns }, { data: learnings }, { data: suppressions }, crmGuard] = context;
    const [{ data: messages }, { data: enrolments }] = history;
    const campaign = (campaigns || []).find((row: any) => row.status === "active") || campaigns?.[0] || null;
    const campaignMap = new Map((campaigns || []).map((row: any) => [row.id, row]));
    const blockedTargets = new Set(
      (suppressions || []).map((row: any) => String(row.target || "").toLowerCase())
    );
    const dailyLimit = Math.min(20, Math.max(1, Number(campaign?.daily_limit) || 20));
    let contactSlots = dailyLimit;
    const messageSummary = new Map<string, any>();
    for (const message of messages || []) {
      const existing = messageSummary.get(message.prospect_id) || {
        latestMessage: null,
        latestSentMessage: null,
        sentCount: 0,
      };
      if (!existing.latestMessage) existing.latestMessage = message;
      if (message.status === "sent") {
        existing.sentCount += 1;
        if (!existing.latestSentMessage) existing.latestSentMessage = message;
      }
      messageSummary.set(message.prospect_id, existing);
    }
    const latestEnrolment = new Map<string, any>();
    const campaignIdsByProspect = new Map<string, string[]>();
    const activeCampaignIdsByProspect = new Map<string, string[]>();
    for (const enrolment of enrolments || []) {
      if (!latestEnrolment.has(enrolment.prospect_id))
        latestEnrolment.set(enrolment.prospect_id, enrolment);
      const campaignIds = campaignIdsByProspect.get(enrolment.prospect_id) || [];
      if (!campaignIds.includes(enrolment.campaign_id)) campaignIds.push(enrolment.campaign_id);
      campaignIdsByProspect.set(enrolment.prospect_id, campaignIds);
      if (isActiveOutreachEnrolmentStatus(enrolment.status)) {
        const activeCampaignIds = activeCampaignIdsByProspect.get(enrolment.prospect_id) || [];
        if (!activeCampaignIds.includes(enrolment.campaign_id)) activeCampaignIds.push(enrolment.campaign_id);
        activeCampaignIdsByProspect.set(enrolment.prospect_id, activeCampaignIds);
      }
    }
    const prospects = (data || [])
      .map((prospect: any) => {
        const campaignIds = campaignIdsByProspect.get(prospect.id) || [];
        const activeCampaignIds = activeCampaignIdsByProspect.get(prospect.id) || [];
        const scoringCampaign = campaignMap.get(activeCampaignIds[0]) || campaign;
        return {
          ...prospect,
          outreach: {
            ...(messageSummary.get(prospect.id) || {
              latestMessage: null,
              latestSentMessage: null,
              sentCount: 0,
            }),
            enrolment: latestEnrolment.get(prospect.id) || null,
            campaignIds,
            activeCampaignIds,
          },
          recommendation: scoreOutreachProspect(prospect, {
            campaign: scoringCampaign,
            learnings: (learnings || []).filter((learning: any) => !scoringCampaign || learning.campaign_id === scoringCampaign.id),
            blockedTargets,
            crmGuard,
          }),
        };
      })
      .sort((a: any, b: any) =>
        b.recommendation.score - a.recommendation.score ||
        String(a.company_name || "").localeCompare(String(b.company_name || ""))
      )
      .map((prospect: any) => {
        if (prospect.recommendation.action !== "contact_today") return prospect;
        const belongsToActiveCampaign = !prospect.outreach.activeCampaignIds.length || prospect.outreach.activeCampaignIds.includes(campaign?.id);
        if (!belongsToActiveCampaign) return prospect;
        if (contactSlots > 0) {
          contactSlots -= 1;
          return prospect;
        }
        return {
          ...prospect,
          recommendation: {
            ...prospect.recommendation,
            action: "hold",
            label: "Hold",
            risks: [
              `Strong fit, but below today’s top ${dailyLimit}`,
              ...prospect.recommendation.risks,
            ].slice(0, 3),
          },
        };
      });
    const { data: members } = await supabaseService
      .from("workspace_members")
      .select("user_id,role,status")
      .eq("workspace_id", account.workspaceId)
      .eq("status", "active")
      .order("created_at");
    const memberIds = (members || []).map((row: any) => row.user_id);
    const { data: profiles } = memberIds.length
      ? await supabaseService
          .from("profiles")
          .select("user_id,display_name,outreach_sender_name,outreach_sender_email")
          .in("user_id", memberIds)
      : { data: [] as any[] };
    const profileById = new Map((profiles || []).map((row: any) => [row.user_id, row]));
    const team = (members || []).map((member: any) => {
      const profile: any = profileById.get(member.user_id);
      return {
        userId: member.user_id,
        role: member.role,
        name: profile?.display_name || "Team member",
        senderName: profile?.outreach_sender_name || profile?.display_name || null,
        senderEmail: profile?.outreach_sender_email || null,
      };
    });
    return NextResponse.json({
      prospects,
      team,
      currentUser: account.userId,
      canManageAssignments: account.role === "owner" || account.role === "manager",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to load outreach prospects" }, { status: 500 });
  }
}
