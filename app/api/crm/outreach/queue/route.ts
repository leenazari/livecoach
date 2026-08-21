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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadQueue(userId: string, campaignId?: string) {
  const today = londonDate();
  let query = supabaseAdmin
    .from("outreach_enrolments")
    .select("*")
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
    supabaseAdmin.from("outreach_suppressions").select("target"),
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
    return {
      ...row,
      prospect: prospectMap.get(row.prospect_id),
      campaign: campaignMap.get(row.campaign_id),
      // Keep the completed send separate from the next draft. After step one
      // sends, current_step advances immediately. Treating the old sent email
      // as the current draft would hide when the follow-up is actually due.
      message: currentMessage || null,
      lastSentMessage: lastSentMessage || null,
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
      .from("outreach_campaigns").select("id").eq("status", "active").order("created_at").limit(1);
    if (error) throw error;
    const sender = await resolveOutreachIdentity(account.userId).catch(() => null);
    return NextResponse.json({ date: londonDate(), queue: campaigns?.[0] ? await loadQueue(account.userId, campaigns[0].id) : [], sender });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load queue" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const account = await resolveRecordScope();
    const body = await req.json().catch(() => ({}));
    const { data: campaigns, error: campaignError } = await supabaseAdmin
      .from("outreach_campaigns").select("*").eq("status", "active").order("created_at").limit(1);
    if (campaignError) throw campaignError;
    const campaign = campaigns?.[0];
    if (!campaign) return NextResponse.json({ error: "Activate a campaign first" }, { status: 400 });
    const limit = Math.min(OUTREACH_DAILY_HARD_LIMIT, Math.max(1, Number(body.limit) || campaign.daily_limit || 20));
    const today = londonDate();
    const existing = await loadQueue(account.userId, campaign.id);
    let selection = { contactToday: 0, held: 0, skipped: 0 };
    let remaining = Math.max(0, limit - existing.length);

    // A deliberate choice from the Prospects tracker may be added directly,
    // but it still goes through the same campaign, suppression, CRM-stage,
    // one-company-per-day and daily-limit protections as the ranked queue.
    const requestedProspectId = String(body.prospectId || "").trim();
    if (requestedProspectId) {
      if (!remaining)
        return NextResponse.json({ error: `Today's queue already has ${limit} people` }, { status: 400 });
      const [{ data: prospect }, { data: suppressions }, crmGuard] = await Promise.all([
        supabaseAdmin.from("outreach_prospects").select("*").eq("id", requestedProspectId).maybeSingle(),
        supabaseAdmin.from("outreach_suppressions").select("target"),
        outreachCrmGuard(),
      ]);
      if (!prospect) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
      if (prospect.assigned_to_user_id && prospect.assigned_to_user_id !== account.userId)
        return NextResponse.json({ error: "This prospect is assigned to another team member" }, { status: 403 });
      if (!prospect.assigned_to_user_id) {
        const { error: claimError } = await supabaseAdmin
          .from("outreach_prospects")
          .update({ assigned_to_user_id: account.userId, updated_at: new Date().toISOString() })
          .eq("id", requestedProspectId)
          .is("assigned_to_user_id", null);
        if (claimError) throw claimError;
        prospect.assigned_to_user_id = account.userId;
      }
      const email = String(prospect.email || "").toLowerCase();
      const domain = String(prospect.company_domain || email.split("@").pop() || "").toLowerCase();
      const blocked = new Set((suppressions || []).map((row: any) => String(row.target || "").toLowerCase()));
      if (["suppressed", "not_interested", "replied", "qualified"].includes(prospect.status))
        return NextResponse.json({ error: "This person is not eligible for prospect outreach" }, { status: 400 });
      if (blocked.has(email) || (domain && blocked.has(domain)))
        return NextResponse.json({ error: "This person or company is on the do-not-contact list" }, { status: 400 });
      if (prospectHasBlockedCrmRelationship(prospect, crmGuard))
        return NextResponse.json({ error: "This CRM relationship is engaged, dormant or not confirmed as a new lead" }, { status: 400 });
      const sameCompanyToday = existing.some((row: any) => {
        const queuedDomain = String(row.prospect?.company_domain || row.prospect?.email?.split("@").pop() || "").toLowerCase();
        return domain && queuedDomain === domain && row.prospect_id !== requestedProspectId;
      });
      if (sameCompanyToday)
        return NextResponse.json({ error: "Another person from this company is already in today's queue" }, { status: 400 });

      const { data: previous } = await supabaseAdmin
        .from("outreach_enrolments")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("prospect_id", requestedProspectId)
        .maybeSingle();
      const { data: otherCampaign } = await supabaseAdmin
        .from("outreach_enrolments")
        .select("campaign_id")
        .eq("prospect_id", requestedProspectId)
        .neq("campaign_id", campaign.id)
        .limit(1)
        .maybeSingle();
      if (otherCampaign)
        return NextResponse.json({ error: "This person belongs to a different campaign. Activate that campaign before preparing them." }, { status: 400 });
      if (previous && ["contacted", "replied", "booked", "completed"].includes(previous.status))
        return NextResponse.json({ error: "This person already has outreach history. Open their history instead." }, { status: 400 });
      const now = new Date().toISOString();
      let enrolmentId = previous?.id;
      if (previous) {
        const resumedStatus = ["researched", "drafted", "approved"].includes(previous.status)
          ? previous.status
          : "queued";
        const { error } = await supabaseAdmin
          .from("outreach_enrolments")
          .update({ queued_for: today, status: resumedStatus, next_action_at: null, updated_at: now })
          .eq("id", previous.id);
        if (error) throw error;
      } else {
        const { data: enrolment, error } = await supabaseAdmin
          .from("outreach_enrolments")
          .insert({ campaign_id: campaign.id, prospect_id: requestedProspectId, queued_for: today, status: "queued", current_step: 1 })
          .select("id")
          .single();
        if (error) throw error;
        enrolmentId = enrolment.id;
      }
      await Promise.all([
        supabaseAdmin.from("outreach_prospects").update({ status: "queued", updated_at: now }).eq("id", requestedProspectId),
        supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: requestedProspectId, kind: "queued", metadata: { date: today, enrolment_id: enrolmentId, source: "prospects_tracker" } }),
      ]);
      const queue = await loadQueue(account.userId, campaign.id);
      return NextResponse.json({ date: today, queue, added: previous ? 0 : 1, selection: { contactToday: 1, held: 0, skipped: 0 } });
    }
    if (!remaining) return NextResponse.json({ date: today, queue: existing, added: 0, selection: { contactToday: 0, held: 0, skipped: 0 } });

    // Due follow-ups come first. A response or suppression changes enrolment
    // status, so those people can never re-enter this selection.
    const { data: assignedRows } = await supabaseAdmin
      .from("outreach_prospects")
      .select("id")
      .eq("assigned_to_user_id", account.userId);
    const assignedProspectIds = (assignedRows || []).map((row: any) => row.id);
    const dueQuery = supabaseAdmin.from("outreach_enrolments").select("*")
      .eq("campaign_id", campaign.id).eq("status", "contacted").lte("next_action_at", new Date().toISOString())
      .order("next_action_at").limit(remaining);
    const { data: due } = assignedProspectIds.length
      ? await dueQuery.in("prospect_id", assignedProspectIds)
      : { data: [] as any[] };
    for (const row of due || []) {
      await supabaseAdmin.from("outreach_enrolments").update({ queued_for: today, status: "queued", updated_at: new Date().toISOString() }).eq("id", row.id);
      remaining -= 1;
    }

    if (remaining > 0) {
      const [{ data: enrolments }, { data: suppressions }, { data: prospects }, { data: learnings }, crmGuard] = await Promise.all([
        supabaseAdmin.from("outreach_enrolments").select("id,campaign_id,prospect_id,status,queued_for").limit(5000),
        supabaseAdmin.from("outreach_suppressions").select("target"),
        supabaseAdmin.from("outreach_prospects").select("*").eq("assigned_to_user_id", account.userId).in("status", ["imported", "queued"]).order("priority_score", { ascending: false }).limit(1000),
        supabaseAdmin.from("outreach_learnings").select("*").eq("campaign_id", campaign.id).eq("status", "promoted").limit(100),
        outreachCrmGuard(),
      ]);
      const enrolmentByProspect = new Map<string, any>();
      const reservedForAnotherCampaign = new Set<string>();
      for (const enrolment of enrolments || []) {
        if (enrolment.campaign_id === campaign.id) enrolmentByProspect.set(enrolment.prospect_id, enrolment);
        else reservedForAnotherCampaign.add(enrolment.prospect_id);
      }
      const blocked = new Set((suppressions || []).map((row: any) => String(row.target).toLowerCase()));
      const chosenCompanies = new Set(existing.map((row: any) =>
        String(row.prospect?.company_domain || row.prospect?.company_name || "").toLowerCase()
      ).filter(Boolean));
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
        const email = String(prospect.email || "").toLowerCase();
        const domain = String(prospect.company_domain || "").toLowerCase();
        const companyKey = domain || String(prospect.company_name || "").toLowerCase();
        const existingEnrolment = enrolmentByProspect.get(prospect.id);
        const canResume = existingEnrolment && ["paused", "queued"].includes(existingEnrolment.status) && !existingEnrolment.queued_for;
        if (!email || reservedForAnotherCampaign.has(prospect.id) || (existingEnrolment && !canResume) || blocked.has(email) || blocked.has(domain) || prospectHasBlockedCrmRelationship(prospect, crmGuard)) continue;
        if (recommendation.action !== "contact_today") {
          if (recommendation.action === "hold") held += 1;
          else skipped += 1;
          continue;
        }
        if (selected.length >= remaining || (companyKey && chosenCompanies.has(companyKey))) continue;
        selected.push(prospect);
        if (companyKey) chosenCompanies.add(companyKey);
      }
      selection = { contactToday: selected.length, held, skipped };
      for (const prospect of selected) {
        const existingEnrolment = enrolmentByProspect.get(prospect.id);
        let enrolmentId = existingEnrolment?.id;
        if (existingEnrolment) {
          const { error } = await supabaseAdmin.from("outreach_enrolments").update({ queued_for: today, status: "queued", updated_at: new Date().toISOString() }).eq("id", existingEnrolment.id);
          if (error) throw error;
        } else {
          const { data: enrolment, error } = await supabaseAdmin.from("outreach_enrolments").insert({ campaign_id: campaign.id, prospect_id: prospect.id, queued_for: today, status: "queued", current_step: 1 }).select("id").single();
          if (error) throw error;
          enrolmentId = enrolment.id;
        }
        await Promise.all([
          supabaseAdmin.from("outreach_prospects").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", prospect.id),
          supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: prospect.id, kind: "queued", metadata: { date: today, enrolment_id: enrolmentId, source: existingEnrolment ? "campaign_membership" : "ranked_pool" } }),
        ]);
      }
    }
    const queue = await loadQueue(account.userId, campaign.id);
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
