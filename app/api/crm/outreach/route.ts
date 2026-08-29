import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { outreachCrmGuard } from "@/lib/outreach";
import { scoreOutreachProspect } from "@/lib/outreach-scoring";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { isActiveOutreachEnrolmentStatus } from "@/lib/outreach-team-safety";
import { resolveOutreachCampaignSelection } from "@/lib/outreach-campaign-selection";
import { loadSendPilotOutreachContext } from "@/lib/sendpilot-outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROSPECT_LIST_FIELDS = [
  "id",
  "assigned_to_user_id",
  "email",
  "first_name",
  "last_name",
  "job_title",
  "company_name",
  "company_domain",
  "website",
  "employee_range",
  "industry",
  "state",
  "country",
  "person_linkedin_url",
  "company_linkedin_url",
  "public_profile",
  "priority",
  "priority_score",
  "status",
  "research",
  "last_researched_at",
  "last_contacted_at",
  "last_reply_at",
  "reply_category",
  "reply_summary",
  "next_action_at",
  "source_metadata",
  "crm_company_id",
  "updated_at",
].join(",");

function hasSavedResearch(value: unknown) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

export async function GET(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const canManageAssignments = account.role === "owner" || account.role === "manager";
    const priority = req.nextUrl.searchParams.get("priority") || "all";
    const status = req.nextUrl.searchParams.get("status") || "all";
    let query = supabaseAdmin
      .from("outreach_prospects")
      .select(PROSPECT_LIST_FIELDS)
      .eq("workspace_id", account.workspaceId)
      .order("priority_score", { ascending: false })
      .order("company_name", { ascending: true })
      .limit(1000);
    if (!canManageAssignments) {
      query = query.or(
        `assigned_to_user_id.is.null,assigned_to_user_id.eq.${account.userId}`
      );
    }
    if (["high", "medium", "low"].includes(priority)) query = query.eq("priority", priority);
    if (status !== "all") query = query.eq("status", status);
    const contextPromise = Promise.all([
      resolveOutreachCampaignSelection(account.userId, account.workspaceId),
      supabaseAdmin.from("outreach_learnings").select("*").eq("workspace_id", account.workspaceId).eq("status", "promoted").limit(100),
      supabaseAdmin.from("outreach_suppressions").select("target").eq("workspace_id", account.workspaceId),
      outreachCrmGuard(),
    ]);
    let messagesQuery = supabaseAdmin
        .from("outreach_messages")
        .select("id,prospect_id,status,subject,step_number,scheduled_at,sent_at,updated_at,message_source")
        .eq("workspace_id", account.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(5000);
    let enrolmentsQuery = supabaseAdmin
        .from("outreach_enrolments")
        .select("campaign_id,prospect_id,recipient_email,status,current_step,last_sent_at,next_action_at,updated_at")
        .eq("workspace_id", account.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(2000);
    if (!canManageAssignments) {
      messagesQuery = messagesQuery.eq("sender_user_id", account.userId);
      enrolmentsQuery = enrolmentsQuery.eq("owner_id", account.userId);
    }
    const historyPromise = Promise.all([messagesQuery, enrolmentsQuery]);
    const [{ data, error }, context, history] = await Promise.all([
      query,
      contextPromise,
      historyPromise,
    ]);
    if (error) throw error;
    const [selection, { data: learnings }, { data: suppressions }, crmGuard] = context;
    const [{ data: messages }, { data: ownEnrolments }] = history;
    const campaigns = selection.campaigns;
    const campaign = selection.campaign;
    const sendpilotContext = await loadSendPilotOutreachContext(
      { userId: account.userId, workspaceId: account.workspaceId },
      {
        prospectIds: (data || [])
          .filter((prospect: any) => prospect.assigned_to_user_id === account.userId)
          .map((prospect: any) => prospect.id),
        campaignIds: campaigns.map((row: any) => row.id),
      }
    );
    const sendpilotByProspect = new Map<string, any>();
    for (const link of sendpilotContext.links) {
      if (!sendpilotByProspect.has(link.outreach_prospect_id)) {
        sendpilotByProspect.set(link.outreach_prospect_id, link);
      }
    }
    let enrolments = ownEnrolments || [];
    if (!canManageAssignments && data?.length) {
      // Once a prospect is assigned, its campaign history follows the
      // prospect even if the original import membership was created by the
      // workspace owner. An unassigned person exposes only a pristine paused
      // campaign label, never another sender's active history or reply detail.
      const assignedIds = (data || [])
        .filter((row: any) => row.assigned_to_user_id === account.userId)
        .map((row: any) => row.id);
      const unassignedIds = (data || [])
        .filter((row: any) => !row.assigned_to_user_id)
        .map((row: any) => row.id);
      const enrolmentFields =
        "campaign_id,prospect_id,recipient_email,status,current_step,last_sent_at,next_action_at,updated_at";
      const [assignedMembershipResult, sharedMembershipResult] =
        await Promise.all([
          assignedIds.length
            ? supabaseAdmin
                .from("outreach_enrolments")
                .select(enrolmentFields)
                .eq("workspace_id", account.workspaceId)
                .in("prospect_id", assignedIds)
            : Promise.resolve({ data: [] as any[], error: null }),
          unassignedIds.length
            ? supabaseAdmin
                .from("outreach_enrolments")
                .select(enrolmentFields)
                .eq("workspace_id", account.workspaceId)
                .eq("status", "paused")
                .is("last_sent_at", null)
                .in("prospect_id", unassignedIds)
            : Promise.resolve({ data: [] as any[], error: null }),
        ]);
      if (assignedMembershipResult.error) throw assignedMembershipResult.error;
      if (sharedMembershipResult.error) throw sharedMembershipResult.error;
      enrolments = [
        ...enrolments,
        ...(assignedMembershipResult.data || []),
        ...(sharedMembershipResult.data || []),
      ].filter(
        (row: any, index: number, rows: any[]) =>
          rows.findIndex(
            (candidate: any) =>
              candidate.campaign_id === row.campaign_id &&
              candidate.prospect_id === row.prospect_id
          ) === index
      );
    }
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
    const activeCampaignIdsByEmail = new Map<string, string[]>();
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
        const recipientEmail = String(enrolment.recipient_email || "")
          .trim()
          .toLowerCase();
        if (recipientEmail) {
          const emailCampaignIds = activeCampaignIdsByEmail.get(recipientEmail) || [];
          if (!emailCampaignIds.includes(enrolment.campaign_id))
            emailCampaignIds.push(enrolment.campaign_id);
          activeCampaignIdsByEmail.set(recipientEmail, emailCampaignIds);
        }
      }
    }
    const prospects = (data || [])
      .map((prospect: any) => {
        const campaignIds = campaignIdsByProspect.get(prospect.id) || [];
        const recipientEmail = String(prospect.email || "").trim().toLowerCase();
        const activeCampaignIds = [
          ...(activeCampaignIdsByProspect.get(prospect.id) || []),
          ...(activeCampaignIdsByEmail.get(recipientEmail) || []),
        ].filter((id, index, all) => all.indexOf(id) === index);
        const scoringCampaign = campaignMap.get(activeCampaignIds[0]) || campaign;
        const recommendation = scoreOutreachProspect(prospect, {
          campaign: scoringCampaign,
          learnings: (learnings || []).filter((learning: any) => !scoringCampaign || learning.campaign_id === scoringCampaign.id),
          blockedTargets,
          crmGuard,
        });
        const { research, ...listProspect } = prospect;
        return {
          ...listProspect,
          has_research: hasSavedResearch(research),
          outreach: {
            ...(messageSummary.get(prospect.id) || {
              latestMessage: null,
              latestSentMessage: null,
              sentCount: 0,
            }),
            enrolment: latestEnrolment.get(prospect.id) || null,
            campaignIds,
            activeCampaignIds,
            sendpilot: (() => {
              const link = sendpilotByProspect.get(prospect.id);
              return link
                ? {
                    syncStatus: link.sync_status,
                    externalStatus: link.external_status,
                    campaignName: link.sendpilot_campaign_name,
                    enrolledAt: link.enrolled_at,
                    lastEventAt: link.last_event_at,
                    error: link.last_error,
                  }
                : null;
            })(),
          },
          recommendation,
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
      canManageAssignments,
      selectedCampaignId: selection.selectedCampaignId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to load outreach prospects" }, { status: 500 });
  }
}
