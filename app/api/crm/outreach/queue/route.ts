import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveOutreachCampaignSelection } from "@/lib/outreach-campaign-selection";
import {
  londonDate,
  OUTREACH_DAILY_HARD_LIMIT,
  outreachCrmGuard,
  prospectHasBlockedCrmRelationship,
} from "@/lib/outreach";
import { scoreOutreachProspect } from "@/lib/outreach-scoring";
import { resolveRecordScope } from "@/lib/record-scope";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { getRequestScope } from "@/lib/request-scope";
import {
  isActiveOutreachEnrolmentStatus,
  isInsideCrossCampaignCooldown,
  outreachSafetyError,
} from "@/lib/outreach-team-safety";
import { outreachSequenceStepAt } from "@/lib/outreach-sequence";
import { canResumeUnsentFirstTouch } from "@/lib/outreach-queue-policy";
import { loadSendPilotOutreachContext } from "@/lib/sendpilot-outreach";
import {
  verifiedCompanyResearchEvidence,
  verifiedJobResearchEvidence,
} from "@/lib/job-research-sources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safetyResponse(error: any) {
  const message = outreachSafetyError(error);
  return message
    ? NextResponse.json({ error: message }, { status: 409 })
    : null;
}

const asText = (value: unknown, max = 800) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function compactSavedResearch(
  value: unknown,
  researchSources: unknown,
  prospect: { website?: unknown; company_domain?: unknown }
) {
  const source = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const jobEvidence = verifiedJobResearchEvidence(
    source,
    Array.isArray(researchSources) ? researchSources : [],
    prospect
  );
  const companyEvidence = verifiedCompanyResearchEvidence(
    source,
    Array.isArray(researchSources) ? researchSources : [],
    prospect
  );
  const list = (items: unknown, maxItems: number, maxLength = 220) =>
    Array.isArray(items)
      ? items
          .map((item) => asText(item, maxLength))
          .filter(Boolean)
          .slice(0, maxItems)
      : [];
  return {
    summary: asText(source.summary, 600),
    companyOverview: companyEvidence.companyOverview,
    companyOverviewUrl: companyEvidence.companyOverviewUrl || null,
    signals: list(source.signals, 3),
    activeJobs: list(source.activeJobs, 4),
    jobBoardUrl: jobEvidence.jobBoardUrl || null,
    jobSignals: jobEvidence.jobSignals,
    likelyNeeds: list(source.likelyNeeds, 2),
    bestAngle: asText(source.bestAngle, 400),
    personalisationFact: asText(source.personalisationFact, 300),
    fitDecision: asText(source.fitDecision, 220),
    confidence: asText(source.confidence, 30),
    generatedAt: asText(source.generatedAt, 60) || null,
  };
}

function compactMessage(message: any) {
  if (!message) return null;
  return {
    id: message.id,
    status: message.status,
    step_number: message.step_number,
    from_email: message.from_email,
    subject: message.subject,
    body_text: message.body_text,
    approved_at: message.approved_at || null,
    scheduled_at: message.scheduled_at || null,
    sent_at: message.sent_at || null,
    updated_at: message.updated_at || null,
    error: message.error || null,
    voice_script: message.voice_script || "",
    voice_status: message.voice_status || "none",
    voice_audio_path: message.voice_audio_path || null,
    voice_public_token: message.voice_public_token || null,
    voice_estimated_seconds: message.voice_estimated_seconds || null,
    voice_generated_at: message.voice_generated_at || null,
    voice_error: message.voice_error || null,
    voice_script_approved_at: message.voice_script_approved_at || null,
    voice_script_approved_by: message.voice_script_approved_by || null,
    voice_script_approved_hash: message.voice_script_approved_hash || null,
  };
}

async function loadQueue(
  userId: string,
  workspaceId: string,
  campaignId?: string
) {
  const today = londonDate();
  let query = supabaseAdmin
    .from("outreach_enrolments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("queued_for", today)
    .in("status", ["queued", "researched", "drafted", "approved", "contacted", "completed", "replied", "booked"])
    .order("created_at", { ascending: true });
  if (campaignId) query = query.eq("campaign_id", campaignId);
  const { data: enrolments, error } = await query;
  if (error) throw error;
  if (!enrolments?.length) return [];
  const prospectIds = [...new Set((enrolments || []).map((row: any) => row.prospect_id))];
  const enrolmentIds = (enrolments || []).map((row: any) => row.id);
  const campaignIds = [...new Set((enrolments || []).map((row: any) => row.campaign_id))];
  const [
    { data: prospects },
    { data: messages },
    { data: campaigns },
    { data: learnings },
    { data: suppressions },
    crmGuard,
    sendpilotContext,
  ] = await Promise.all([
    prospectIds.length ? supabaseAdmin.from("outreach_prospects").select("*").in("id", prospectIds) : Promise.resolve({ data: [] }),
    enrolmentIds.length ? supabaseAdmin.from("outreach_messages").select("*").in("enrolment_id", enrolmentIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? supabaseAdmin.from("outreach_campaigns").select("*").in("id", campaignIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? supabaseAdmin.from("outreach_learnings").select("*").in("campaign_id", campaignIds).eq("status", "promoted") : Promise.resolve({ data: [] }),
    supabaseAdmin.from("outreach_suppressions").select("target").eq("workspace_id", workspaceId),
    outreachCrmGuard(),
    loadSendPilotOutreachContext(
      { userId, workspaceId },
      { prospectIds, campaignIds }
    ),
  ]);
  const prospectMap = new Map((prospects || []).map((row: any) => [row.id, row]));
  const campaignMap = new Map((campaigns || []).map((row: any) => [row.id, row]));
  const messagesByEnrolment = new Map<string, any[]>();
  for (const message of messages || []) {
    const rows = messagesByEnrolment.get(message.enrolment_id) || [];
    rows.push(message);
    messagesByEnrolment.set(message.enrolment_id, rows);
  }
  const blockedTargets = new Set((suppressions || []).map((row: any) => String(row.target || "").toLowerCase()));
  const sendpilotMappingByCampaign = new Map(
    sendpilotContext.mappings.map((mapping) => [
      mapping.livecoachCampaignId,
      mapping,
    ])
  );
  const sendpilotLinkByEnrolment = new Map<string, any>();
  const sendpilotLinkByProspect = new Map<string, any>();
  for (const link of sendpilotContext.links) {
    if (link.outreach_enrolment_id && !sendpilotLinkByEnrolment.has(link.outreach_enrolment_id)) {
      sendpilotLinkByEnrolment.set(link.outreach_enrolment_id, link);
    }
    if (!sendpilotLinkByProspect.has(link.outreach_prospect_id)) {
      sendpilotLinkByProspect.set(link.outreach_prospect_id, link);
    }
  }
  return (enrolments || []).filter((row: any) =>
    prospectMap.get(row.prospect_id)?.assigned_to_user_id === userId
  ).map((row: any) => {
    const rows = (messagesByEnrolment.get(row.id) || []).sort(
      (a: any, b: any) => Number(b.step_number) - Number(a.step_number)
    );
    const currentMessage = rows.find(
      (message: any) => Number(message.step_number) === Number(row.current_step)
    );
    const lastSentMessage = rows
      .filter((message: any) => message.status === "sent")
      .sort(
        (a: any, b: any) =>
          new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime()
      )[0];
    const prospect = prospectMap.get(row.prospect_id);
    const research = compactSavedResearch(
      row.research || prospect?.research,
      row.research_sources,
      prospect || {}
    );
    const campaign = campaignMap.get(row.campaign_id);
    const sequenceStep = outreachSequenceStepAt(
      campaign?.sequence,
      Number(row.current_step) || 1
    );
    const sendpilotMapping = sendpilotMappingByCampaign.get(row.campaign_id);
    const sendpilotLink =
      sendpilotLinkByEnrolment.get(row.id) ||
      sendpilotLinkByProspect.get(row.prospect_id) ||
      null;
    const messageHistory = rows
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.sent_at || b.updated_at || b.created_at || 0).getTime() -
          new Date(a.sent_at || a.updated_at || a.created_at || 0).getTime()
      )
      .slice(0, 5)
      .map(compactMessage);
    const sentCount = rows.filter(
      (message: any) => message.status === "sent"
    ).length;
    const isFollowUp = sentCount > 0;
    return {
      ...row,
      prospect,
      campaign,
      sequenceStep,
      sequenceStepDue:
        !row.next_action_at ||
        new Date(row.next_action_at).getTime() <= Date.now(),
      // Keep the completed send separate from the next draft. After step one
      // sends, current_step advances immediately. Treating the old sent email
      // as the current draft would hide when the follow-up is actually due.
      message: compactMessage(currentMessage),
      lastSentMessage: compactMessage(lastSentMessage),
      messageHistory,
      queueKind: isFollowUp ? "follow_up" : "new_contact",
      previousContact: lastSentMessage
        ? {
            sentAt: lastSentMessage.sent_at || null,
            subject: lastSentMessage.subject || "",
            stepNumber: Number(lastSentMessage.step_number) || 1,
            fromEmail: lastSentMessage.from_email || "",
          }
        : null,
      savedResearch: research,
      researchSourceCount: Array.isArray(row.research_sources)
        ? row.research_sources.length
        : 0,
      sentCount,
      sendpilot: {
        connected: sendpilotContext.connected,
        webhookConfigured: sendpilotContext.webhookConfigured,
        mapped: sendpilotMapping?.active === true,
        campaignName: sendpilotMapping?.sendpilotCampaignName || null,
        execution: sendpilotLink
          ? {
              syncStatus: sendpilotLink.sync_status,
              externalStatus: sendpilotLink.external_status,
              campaignName: sendpilotLink.sendpilot_campaign_name,
              enrolledAt: sendpilotLink.enrolled_at,
              lastEventAt: sendpilotLink.last_event_at,
              lastMessageAt: sendpilotLink.last_message_at,
              lastReplyAt: sendpilotLink.last_reply_at,
              lastConnectionAt: sendpilotLink.last_connection_at,
              error: sendpilotLink.last_error,
            }
          : null,
      },
      recommendation: scoreOutreachProspect(prospectMap.get(row.prospect_id), {
        campaign: campaignMap.get(row.campaign_id),
        learnings: (learnings || []).filter((learning: any) => learning.campaign_id === row.campaign_id),
        blockedTargets,
        crmGuard,
        dueFollowUp: row.status === "queued" && Number(row.current_step) > 1,
      }),
    };
  });
}

export async function GET() {
  try {
    const account = await resolveRecordScope();
    const selection = await resolveOutreachCampaignSelection(
      account.userId,
      account.workspaceId
    );
    const sender = await resolveOutreachIdentity(account.userId).catch(() => null);
    return NextResponse.json({
      date: londonDate(),
      // Today is one working list across every campaign. The selected
      // campaign remains the boundary for Rank + build, but a salesperson can
      // review and finish already queued work without switching campaigns.
      queue: await loadQueue(account.userId, account.workspaceId),
      sender,
      selectedCampaignId: selection.selectedCampaignId,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load queue" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const account = await resolveRecordScope();
    const requestScope = getRequestScope();
    const body = await req.json().catch(() => ({}));
    const campaignSelection = await resolveOutreachCampaignSelection(
      account.userId,
      account.workspaceId
    );
    const requestedCampaignId = String(body.campaignId || "").trim();
    const campaign = requestedCampaignId
      ? campaignSelection.campaigns.find(
          (row: any) =>
            row.id === requestedCampaignId && row.status === "active"
        ) || null
      : campaignSelection.campaign;
    if (requestedCampaignId && !campaign) {
      return NextResponse.json(
        { error: "That prospect's campaign is not active" },
        { status: 400 }
      );
    }
    if (!campaign) {
      return NextResponse.json(
        { error: "Activate and select a campaign first" },
        { status: 400 }
      );
    }
    const limit = Math.min(OUTREACH_DAILY_HARD_LIMIT, Math.max(1, Number(body.limit) || campaign.daily_limit || 20));
    const today = londonDate();
    // The hard limit applies to the salesperson's entire day, not separately
    // to every campaign. The selected campaign controls where new work comes
    // from, while already queued work from any campaign consumes capacity.
    const existing = await loadQueue(account.userId, account.workspaceId);
    let selection = {
      contactToday: 0,
      firstTouches: 0,
      followUps: 0,
      held: 0,
      skipped: 0,
    };
    let remaining = Math.max(0, limit - existing.length);

    // A deliberate choice from the Prospects tracker may be added directly,
    // but it still goes through the same campaign, suppression, CRM-stage,
    // exact-email and daily-limit protections as the ranked queue.
    const requestedProspectId = String(body.prospectId || "").trim();
    if (requestedProspectId) {
      if (!remaining)
        return NextResponse.json({ error: `Today's queue already has ${limit} people` }, { status: 400 });
      const [{ data: prospect }, { data: suppressions }, crmGuard] = await Promise.all([
        supabaseAdmin.from("outreach_prospects").select("*").eq("workspace_id", account.workspaceId).eq("id", requestedProspectId).maybeSingle(),
        supabaseAdmin.from("outreach_suppressions").select("target").eq("workspace_id", account.workspaceId),
        outreachCrmGuard(),
      ]);
      if (!prospect) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
      if (prospect.assigned_to_user_id && prospect.assigned_to_user_id !== account.userId)
        return NextResponse.json({ error: "This prospect is assigned to another team member" }, { status: 403 });
      const email = String(prospect.email || "").trim().toLowerCase();
      const domain = String(prospect.company_domain || email.split("@").pop() || "").trim().toLowerCase();
      const blocked = new Set((suppressions || []).map((row: any) => String(row.target || "").toLowerCase()));
      if (["suppressed", "not_interested", "replied", "qualified"].includes(prospect.status))
        return NextResponse.json({ error: "This person is not eligible for prospect outreach" }, { status: 400 });
      if (blocked.has(email) || (domain && blocked.has(domain)))
        return NextResponse.json({ error: "This person or company is on the do-not-contact list" }, { status: 400 });
      if (prospectHasBlockedCrmRelationship(prospect, crmGuard))
        return NextResponse.json({ error: "This CRM relationship is engaged, dormant or not confirmed as a new lead" }, { status: 400 });
      const [
        { data: previous, error: previousError },
        { count: campaignMembershipCount, error: membershipCountError },
        { data: otherCampaigns, error: otherCampaignsError },
      ] = await Promise.all([
        supabaseAdmin
          .from("outreach_enrolments")
          .select("*")
          .eq("workspace_id", account.workspaceId)
          .eq("campaign_id", campaign.id)
          .eq("prospect_id", requestedProspectId)
          .maybeSingle(),
        supabaseAdmin
          .from("outreach_enrolments")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", account.workspaceId)
          .eq("campaign_id", campaign.id),
        supabaseAdmin
          .from("outreach_enrolments")
          .select("id,campaign_id,status,last_sent_at")
          .eq("workspace_id", account.workspaceId)
          .eq("recipient_email", email)
          .neq("campaign_id", campaign.id),
      ]);
      if (previousError) throw previousError;
      if (membershipCountError) throw membershipCountError;
      if (otherCampaignsError) throw otherCampaignsError;
      if ((campaignMembershipCount || 0) > 0 && !previous) {
        return NextResponse.json(
          { error: "This prospect is not part of your selected campaign" },
          { status: 400 }
        );
      }
      const activeOtherCampaign = (otherCampaigns || []).find((row: any) =>
        isActiveOutreachEnrolmentStatus(row.status)
      );
      if (activeOtherCampaign) {
        return NextResponse.json(
          { error: "This email address is already active in another campaign. Open its existing outreach history instead." },
          { status: 409 }
        );
      }
      const cooldownConflict = (otherCampaigns || []).find((row: any) =>
        isInsideCrossCampaignCooldown(row.last_sent_at)
      );
      const overrideReason = String(body.cooldownOverrideReason || "").trim();
      if (cooldownConflict && !overrideReason) {
        return NextResponse.json(
          { error: "This person was contacted through another campaign within the last 30 days. A workspace owner or manager may override this safety pause with a recorded reason." },
          { status: 409 }
        );
      }
      if (overrideReason) {
        if (
          !requestScope ||
          requestScope.userId !== account.userId ||
          !["owner", "manager"].includes(requestScope.role)
        ) {
          return NextResponse.json(
            { error: "Only a workspace owner or manager can override the campaign cooldown" },
            { status: 403 }
          );
        }
        if (overrideReason.length < 10 || overrideReason.length > 500) {
          return NextResponse.json(
            { error: "Give a clear override reason between 10 and 500 characters" },
            { status: 400 }
          );
        }
      }
      if (previous && ["contacted", "replied", "booked", "completed"].includes(previous.status))
        return NextResponse.json({ error: "This person already has outreach history. Open their history instead." }, { status: 400 });
      if (!prospect.assigned_to_user_id) {
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from("outreach_prospects")
          .update({
            assigned_to_user_id: account.userId,
            visibility: "team",
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", account.workspaceId)
          .eq("id", requestedProspectId)
          .is("assigned_to_user_id", null)
          .select("assigned_to_user_id")
          .maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) {
          return NextResponse.json(
            { error: "Another teammate claimed this prospect first" },
            { status: 409 }
          );
        }
        prospect.assigned_to_user_id = account.userId;
      }
      const now = new Date().toISOString();
      const overrideFields = cooldownConflict && overrideReason
        ? {
            cooldown_override_at: now,
            cooldown_override_by: account.userId,
            cooldown_override_reason: overrideReason,
          }
        : {};
      let enrolmentId = previous?.id;
      if (previous) {
        const resumedStatus = ["researched", "drafted", "approved"].includes(previous.status)
          ? previous.status
          : "queued";
        const { error } = await supabaseAdmin
          .from("outreach_enrolments")
          .update({ queued_for: today, status: resumedStatus, next_action_at: null, updated_at: now, ...overrideFields })
          .eq("id", previous.id);
        if (error) {
          const response = safetyResponse(error);
          if (response) return response;
          throw error;
        }
      } else {
        const { data: enrolment, error } = await supabaseAdmin
          .from("outreach_enrolments")
          .insert({ campaign_id: campaign.id, prospect_id: requestedProspectId, queued_for: today, status: "queued", current_step: 1, ...overrideFields })
          .select("id")
          .single();
        if (error) {
          const response = safetyResponse(error);
          if (response) return response;
          throw error;
        }
        enrolmentId = enrolment.id;
      }
      await Promise.all([
        supabaseAdmin.from("outreach_prospects").update({ status: "queued", updated_at: now }).eq("id", requestedProspectId),
        supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: requestedProspectId, kind: "queued", metadata: { date: today, enrolment_id: enrolmentId, source: "prospects_tracker" } }),
      ]);
      const directIsFollowUp = Boolean(previous?.last_sent_at) ||
        Number(previous?.current_step || 1) > 1;
      const queue = await loadQueue(account.userId, account.workspaceId);
      return NextResponse.json({
        date: today,
        queue,
        added: previous ? 0 : 1,
        selection: {
          contactToday: 1,
          firstTouches: directIsFollowUp ? 0 : 1,
          followUps: directIsFollowUp ? 1 : 0,
          held: 0,
          skipped: 0,
        },
      });
    }
    if (!remaining) {
      return NextResponse.json({
        date: today,
        queue: await loadQueue(account.userId, account.workspaceId),
        added: 0,
        selection: {
          contactToday: 0,
          firstTouches: 0,
          followUps: 0,
          held: 0,
          skipped: 0,
        },
      });
    }

    // First touches fill today's available slots before due follow ups.
    // This moves the whole eligible campaign audience through step one before
    // repeatedly advancing the first few people. Protected, suppressed and
    // low-evidence prospects still remain safely held.
    if (remaining > 0) {
      const [{ data: enrolments }, { data: suppressions }, { data: prospects }, { data: learnings }, crmGuard] = await Promise.all([
        supabaseAdmin.from("outreach_enrolments").select("id,campaign_id,prospect_id,status,queued_for,last_sent_at,recipient_email").eq("workspace_id", account.workspaceId).limit(5000),
        supabaseAdmin.from("outreach_suppressions").select("target").eq("workspace_id", account.workspaceId),
        supabaseAdmin.from("outreach_prospects").select("*").eq("workspace_id", account.workspaceId).or(`assigned_to_user_id.is.null,assigned_to_user_id.eq.${account.userId}`).in("status", ["imported", "queued", "ready"]).order("priority_score", { ascending: false }).limit(1000),
        supabaseAdmin.from("outreach_learnings").select("*").eq("workspace_id", account.workspaceId).eq("campaign_id", campaign.id).eq("status", "promoted").limit(100),
        outreachCrmGuard(),
      ]);
      const enrolmentByProspect = new Map<string, any>();
      const campaignProspectIds = new Set<string>();
      const reservedEmailsForAnotherCampaign = new Set<string>();
      for (const enrolment of enrolments || []) {
        if (enrolment.campaign_id === campaign.id) {
          enrolmentByProspect.set(enrolment.prospect_id, enrolment);
          campaignProspectIds.add(enrolment.prospect_id);
        }
        else if (
          isActiveOutreachEnrolmentStatus(enrolment.status) ||
          isInsideCrossCampaignCooldown(enrolment.last_sent_at)
        ) {
          const reservedEmail = String(enrolment.recipient_email || "")
            .trim()
            .toLowerCase();
          if (reservedEmail) reservedEmailsForAnotherCampaign.add(reservedEmail);
        }
      }
      const blocked = new Set((suppressions || []).map((row: any) => String(row.target).toLowerCase()));
      const chosenEmails = new Set(
        existing
          .map((row: any) => String(row.recipient_email || "").trim().toLowerCase())
          .filter(Boolean)
      );
      const selected: any[] = [];
      let held = 0;
      let skipped = 0;
      // A populated campaign membership is the audience boundary. This keeps
      // Workable leads out of the recruitment-leaders campaign and vice versa.
      // Older campaigns with no memberships retain the legacy ranked-pool
      // fallback until they are explicitly populated.
      const audienceProspects = campaignProspectIds.size
        ? (prospects || []).filter((prospect: any) =>
            campaignProspectIds.has(prospect.id)
          )
        : prospects || [];
      const ranked = audienceProspects.map((prospect: any) => ({
        prospect,
        recommendation: scoreOutreachProspect(prospect, {
          campaign,
          learnings: learnings || [],
          blockedTargets: blocked,
          crmGuard,
        }),
      })).sort((a: any, b: any) =>
        b.recommendation.score - a.recommendation.score ||
        String(a.prospect.company_name || "").localeCompare(String(b.prospect.company_name || ""))
      );
      for (const { prospect, recommendation } of ranked) {
        const email = String(prospect.email || "").trim().toLowerCase();
        const domain = String(prospect.company_domain || "").trim().toLowerCase();
        const existingEnrolment = enrolmentByProspect.get(prospect.id);
        // Prepared first-touch work must return to today's queue without
        // spending research tokens again or losing the exact saved draft.
        const canResume = canResumeUnsentFirstTouch(existingEnrolment, today);
        if (!email || reservedEmailsForAnotherCampaign.has(email) || (existingEnrolment && !canResume) || blocked.has(email) || blocked.has(domain) || prospectHasBlockedCrmRelationship(prospect, crmGuard)) continue;
        if (recommendation.action !== "contact_today") {
          if (recommendation.action === "hold") held += 1;
          else skipped += 1;
          continue;
        }
        if (selected.length >= remaining || chosenEmails.has(email)) continue;
        selected.push(prospect);
        chosenEmails.add(email);
      }
      let addedSelected = 0;
      for (const prospect of selected) {
        if (!prospect.assigned_to_user_id) {
          const { data: claimed, error: claimError } = await supabaseAdmin
            .from("outreach_prospects")
            .update({
              assigned_to_user_id: account.userId,
              visibility: "team",
              updated_at: new Date().toISOString(),
            })
            .eq("workspace_id", account.workspaceId)
            .eq("id", prospect.id)
            .is("assigned_to_user_id", null)
            .select("id,assigned_to_user_id")
            .maybeSingle();
          if (claimError) throw claimError;
          if (!claimed) {
            held += 1;
            continue;
          }
          prospect.assigned_to_user_id = account.userId;
        }
        const existingEnrolment = enrolmentByProspect.get(prospect.id);
        let enrolmentId = existingEnrolment?.id;
        if (existingEnrolment) {
          const resumedStatus = ["researched", "drafted", "approved"].includes(
            existingEnrolment.status
          )
            ? existingEnrolment.status
            : "queued";
          const { error } = await supabaseAdmin.from("outreach_enrolments").update({ queued_for: today, status: resumedStatus, updated_at: new Date().toISOString() }).eq("id", existingEnrolment.id);
          if (error) {
            if (outreachSafetyError(error)) {
              held += 1;
              continue;
            }
            throw error;
          }
        } else {
          const { data: enrolment, error } = await supabaseAdmin.from("outreach_enrolments").insert({ campaign_id: campaign.id, prospect_id: prospect.id, queued_for: today, status: "queued", current_step: 1 }).select("id").single();
          if (error) {
            if (outreachSafetyError(error)) {
              held += 1;
              continue;
            }
            throw error;
          }
          enrolmentId = enrolment.id;
        }
        addedSelected += 1;
        await Promise.all([
          supabaseAdmin.from("outreach_prospects").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", prospect.id),
          supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: prospect.id, kind: "queued", metadata: { date: today, enrolment_id: enrolmentId, source: existingEnrolment ? "campaign_membership" : "ranked_pool" } }),
        ]);
      }
      selection = {
        contactToday: addedSelected,
        firstTouches: addedSelected,
        followUps: 0,
        held: selection.held + held,
        skipped,
      };
      remaining = Math.max(0, remaining - addedSelected);
    }

    // Due follow ups use only capacity left after the first touch wave. A
    // response or suppression changes enrolment status, so those people can
    // never re-enter this selection.
    if (remaining > 0) {
      const { data: assignedRows, error: assignedError } = await supabaseAdmin
        .from("outreach_prospects")
        .select("id")
        .eq("workspace_id", account.workspaceId)
        .eq("assigned_to_user_id", account.userId);
      if (assignedError) throw assignedError;
      const assignedProspectIds = (assignedRows || []).map((row: any) => row.id);
      if (assignedProspectIds.length) {
        const { data: due, error: dueError } = await supabaseAdmin
          .from("outreach_enrolments")
          .select("*")
          .eq("workspace_id", account.workspaceId)
          .eq("campaign_id", campaign.id)
          .eq("status", "contacted")
          .lte("next_action_at", new Date().toISOString())
          .in("prospect_id", assignedProspectIds)
          .order("next_action_at")
          .limit(remaining);
        if (dueError) throw dueError;
        let queuedFollowUps = 0;
        for (const row of due || []) {
          const { error } = await supabaseAdmin
            .from("outreach_enrolments")
            .update({
              queued_for: today,
              status: "queued",
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          if (error) {
            if (outreachSafetyError(error)) {
              selection.held += 1;
              continue;
            }
            throw error;
          }
          queuedFollowUps += 1;
        }
        selection.contactToday += queuedFollowUps;
        selection.followUps += queuedFollowUps;
      }
    }
    const queue = await loadQueue(account.userId, account.workspaceId);
    return NextResponse.json({
      date: today,
      queue,
      added: Math.max(0, queue.length - existing.length),
      selection,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to build queue" }, { status: 500 });
  }
}
