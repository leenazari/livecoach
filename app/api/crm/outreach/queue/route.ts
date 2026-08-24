import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
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

function compactSavedResearch(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const list = (items: unknown, maxItems: number, maxLength = 220) =>
    Array.isArray(items)
      ? items
          .map((item) => asText(item, maxLength))
          .filter(Boolean)
          .slice(0, maxItems)
      : [];
  return {
    summary: asText(source.summary, 600),
    signals: list(source.signals, 3),
    activeJobs: list(source.activeJobs, 4),
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
  const [{ data: prospects }, { data: messages }, { data: campaigns }, { data: learnings }, { data: suppressions }, crmGuard] = await Promise.all([
    prospectIds.length ? supabaseAdmin.from("outreach_prospects").select("*").in("id", prospectIds) : Promise.resolve({ data: [] }),
    enrolmentIds.length ? supabaseAdmin.from("outreach_messages").select("*").in("enrolment_id", enrolmentIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? supabaseAdmin.from("outreach_campaigns").select("*").in("id", campaignIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? supabaseAdmin.from("outreach_learnings").select("*").in("campaign_id", campaignIds).eq("status", "promoted") : Promise.resolve({ data: [] }),
    supabaseAdmin.from("outreach_suppressions").select("target").eq("workspace_id", workspaceId),
    outreachCrmGuard(),
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
    const research = compactSavedResearch(row.research || prospectMap.get(row.prospect_id)?.research);
    const messageHistory = rows
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.sent_at || b.updated_at || b.created_at || 0).getTime() -
          new Date(a.sent_at || a.updated_at || a.created_at || 0).getTime()
      )
      .slice(0, 5)
      .map(compactMessage);
    return {
      ...row,
      prospect: prospectMap.get(row.prospect_id),
      campaign: campaignMap.get(row.campaign_id),
      // Keep the completed send separate from the next draft. After step one
      // sends, current_step advances immediately. Treating the old sent email
      // as the current draft would hide when the follow-up is actually due.
      message: compactMessage(currentMessage),
      lastSentMessage: compactMessage(lastSentMessage),
      messageHistory,
      savedResearch: research,
      researchSourceCount: Array.isArray(row.research_sources)
        ? row.research_sources.length
        : 0,
      sentCount: rows.filter((message: any) => message.status === "sent").length,
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
    const { data: campaigns, error } = await supabaseAdmin
      .from("outreach_campaigns").select("id").eq("workspace_id", account.workspaceId).eq("status", "active").order("created_at").limit(1);
    if (error) throw error;
    const sender = await resolveOutreachIdentity(account.userId).catch(() => null);
    return NextResponse.json({ date: londonDate(), queue: campaigns?.[0] ? await loadQueue(account.userId, account.workspaceId, campaigns[0].id) : [], sender });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load queue" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const account = await resolveRecordScope();
    const requestScope = getRequestScope();
    const body = await req.json().catch(() => ({}));
    const { data: campaigns, error: campaignError } = await supabaseAdmin
      .from("outreach_campaigns").select("*").eq("workspace_id", account.workspaceId).eq("status", "active").order("created_at").limit(1);
    if (campaignError) throw campaignError;
    const campaign = campaigns?.[0];
    if (!campaign) return NextResponse.json({ error: "Activate a campaign first" }, { status: 400 });
    const limit = Math.min(OUTREACH_DAILY_HARD_LIMIT, Math.max(1, Number(body.limit) || campaign.daily_limit || 20));
    const today = londonDate();
    const existing = await loadQueue(
      account.userId,
      account.workspaceId,
      campaign.id
    );
    let selection = { contactToday: 0, held: 0, skipped: 0 };
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
      if (!prospect.assigned_to_user_id) {
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from("outreach_prospects")
          .update({ assigned_to_user_id: account.userId, updated_at: new Date().toISOString() })
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
      const email = String(prospect.email || "").trim().toLowerCase();
      const domain = String(prospect.company_domain || email.split("@").pop() || "").trim().toLowerCase();
      const blocked = new Set((suppressions || []).map((row: any) => String(row.target || "").toLowerCase()));
      if (["suppressed", "not_interested", "replied", "qualified"].includes(prospect.status))
        return NextResponse.json({ error: "This person is not eligible for prospect outreach" }, { status: 400 });
      if (blocked.has(email) || (domain && blocked.has(domain)))
        return NextResponse.json({ error: "This person or company is on the do-not-contact list" }, { status: 400 });
      if (prospectHasBlockedCrmRelationship(prospect, crmGuard))
        return NextResponse.json({ error: "This CRM relationship is engaged, dormant or not confirmed as a new lead" }, { status: 400 });
      const { data: previous } = await supabaseAdmin
        .from("outreach_enrolments")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("prospect_id", requestedProspectId)
        .maybeSingle();
      const { data: otherCampaigns } = await supabaseAdmin
        .from("outreach_enrolments")
        .select("id,campaign_id,status,last_sent_at")
        .eq("workspace_id", account.workspaceId)
        .eq("recipient_email", email)
        .neq("campaign_id", campaign.id);
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
      const queue = await loadQueue(account.userId, account.workspaceId, campaign.id);
      return NextResponse.json({ date: today, queue, added: previous ? 0 : 1, selection: { contactToday: 1, held: 0, skipped: 0 } });
    }
    if (!remaining) return NextResponse.json({ date: today, queue: existing, added: 0, selection: { contactToday: 0, held: 0, skipped: 0 } });

    // Due follow-ups come first. A response or suppression changes enrolment
    // status, so those people can never re-enter this selection.
    const { data: assignedRows } = await supabaseAdmin
      .from("outreach_prospects")
      .select("id")
      .eq("workspace_id", account.workspaceId)
      .eq("assigned_to_user_id", account.userId);
    const assignedProspectIds = (assignedRows || []).map((row: any) => row.id);
    const dueQuery = supabaseAdmin.from("outreach_enrolments").select("*")
      .eq("campaign_id", campaign.id).eq("status", "contacted").lte("next_action_at", new Date().toISOString())
      .order("next_action_at").limit(remaining);
    const { data: due } = assignedProspectIds.length
      ? await dueQuery.in("prospect_id", assignedProspectIds)
      : { data: [] as any[] };
    for (const row of due || []) {
      const { error } = await supabaseAdmin
        .from("outreach_enrolments")
        .update({ queued_for: today, status: "queued", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) {
        if (outreachSafetyError(error)) {
          selection.held += 1;
          continue;
        }
        throw error;
      }
      remaining -= 1;
    }

    if (remaining > 0) {
      const [{ data: enrolments }, { data: suppressions }, { data: prospects }, { data: learnings }, crmGuard] = await Promise.all([
        supabaseAdmin.from("outreach_enrolments").select("id,campaign_id,prospect_id,status,queued_for,last_sent_at,recipient_email").eq("workspace_id", account.workspaceId).limit(5000),
        supabaseAdmin.from("outreach_suppressions").select("target").eq("workspace_id", account.workspaceId),
        supabaseAdmin.from("outreach_prospects").select("*").eq("workspace_id", account.workspaceId).eq("assigned_to_user_id", account.userId).in("status", ["imported", "queued"]).order("priority_score", { ascending: false }).limit(1000),
        supabaseAdmin.from("outreach_learnings").select("*").eq("workspace_id", account.workspaceId).eq("campaign_id", campaign.id).eq("status", "promoted").limit(100),
        outreachCrmGuard(),
      ]);
      const enrolmentByProspect = new Map<string, any>();
      const reservedEmailsForAnotherCampaign = new Set<string>();
      for (const enrolment of enrolments || []) {
        if (enrolment.campaign_id === campaign.id) enrolmentByProspect.set(enrolment.prospect_id, enrolment);
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
      const ranked = (prospects || []).map((prospect: any) => ({
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
        const canResume = existingEnrolment && ["paused", "queued"].includes(existingEnrolment.status) && !existingEnrolment.queued_for;
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
        const existingEnrolment = enrolmentByProspect.get(prospect.id);
        let enrolmentId = existingEnrolment?.id;
        if (existingEnrolment) {
          const { error } = await supabaseAdmin.from("outreach_enrolments").update({ queued_for: today, status: "queued", updated_at: new Date().toISOString() }).eq("id", existingEnrolment.id);
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
        held: selection.held + held,
        skipped,
      };
    }
    const queue = await loadQueue(account.userId, account.workspaceId, campaign.id);
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
