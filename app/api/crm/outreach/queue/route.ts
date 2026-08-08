import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { activeClientDomains, londonDate, OUTREACH_DAILY_HARD_LIMIT } from "@/lib/outreach";
import { scoreOutreachProspect } from "@/lib/outreach-scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadQueue() {
  const today = londonDate();
  const { data: enrolments, error } = await supabaseAdmin
    .from("outreach_enrolments")
    .select("*")
    .eq("queued_for", today)
    .in("status", ["queued", "researched", "drafted", "approved", "contacted"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!enrolments?.length) return [];
  const prospectIds = [...new Set((enrolments || []).map((row: any) => row.prospect_id))];
  const enrolmentIds = (enrolments || []).map((row: any) => row.id);
  const campaignIds = [...new Set((enrolments || []).map((row: any) => row.campaign_id))];
  const [{ data: prospects }, { data: messages }, { data: campaigns }, { data: learnings }, { data: suppressions }, activeDomains] = await Promise.all([
    prospectIds.length ? supabaseAdmin.from("outreach_prospects").select("*").in("id", prospectIds) : Promise.resolve({ data: [] }),
    enrolmentIds.length ? supabaseAdmin.from("outreach_messages").select("*").in("enrolment_id", enrolmentIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? supabaseAdmin.from("outreach_campaigns").select("*").in("id", campaignIds) : Promise.resolve({ data: [] }),
    campaignIds.length ? supabaseAdmin.from("outreach_learnings").select("*").in("campaign_id", campaignIds).eq("status", "promoted") : Promise.resolve({ data: [] }),
    supabaseAdmin.from("outreach_suppressions").select("target"),
    activeClientDomains(),
  ]);
  const prospectMap = new Map((prospects || []).map((row: any) => [row.id, row]));
  const campaignMap = new Map((campaigns || []).map((row: any) => [row.id, row]));
  const messageMap = new Map((messages || []).map((row: any) => [`${row.enrolment_id}:${row.step_number}`, row]));
  const blockedTargets = new Set((suppressions || []).map((row: any) => String(row.target || "").toLowerCase()));
  return (enrolments || []).map((row: any) => ({
    ...row,
    prospect: prospectMap.get(row.prospect_id),
    campaign: campaignMap.get(row.campaign_id),
    message: messageMap.get(`${row.id}:${row.current_step}`) || null,
    recommendation: scoreOutreachProspect(prospectMap.get(row.prospect_id), {
      campaign: campaignMap.get(row.campaign_id),
      learnings: (learnings || []).filter((learning: any) => learning.campaign_id === row.campaign_id),
      blockedTargets,
      activeClientDomains: activeDomains,
      dueFollowUp: Number(row.current_step) > 1,
    }),
  }));
}

export async function GET() {
  try {
    return NextResponse.json({ date: londonDate(), queue: await loadQueue() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load queue" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { data: campaigns, error: campaignError } = await supabaseAdmin
      .from("outreach_campaigns").select("*").eq("status", "active").order("created_at").limit(1);
    if (campaignError) throw campaignError;
    const campaign = campaigns?.[0];
    if (!campaign) return NextResponse.json({ error: "Activate a campaign first" }, { status: 400 });
    const limit = Math.min(OUTREACH_DAILY_HARD_LIMIT, Math.max(1, Number(body.limit) || campaign.daily_limit || 20));
    const today = londonDate();
    const existing = await loadQueue();
    let selection = { contactToday: 0, held: 0, skipped: 0 };
    let remaining = Math.max(0, limit - existing.length);
    if (!remaining) return NextResponse.json({ date: today, queue: existing, added: 0, selection: { contactToday: 0, held: 0, skipped: 0 } });

    // Due follow-ups come first. A response or suppression changes enrolment
    // status, so those people can never re-enter this selection.
    const { data: due } = await supabaseAdmin.from("outreach_enrolments").select("*")
      .eq("campaign_id", campaign.id).eq("status", "contacted").lte("next_action_at", new Date().toISOString())
      .order("next_action_at").limit(remaining);
    for (const row of due || []) {
      await supabaseAdmin.from("outreach_enrolments").update({ queued_for: today, status: "queued", updated_at: new Date().toISOString() }).eq("id", row.id);
      remaining -= 1;
    }

    if (remaining > 0) {
      const [{ data: enrolled }, { data: suppressions }, { data: prospects }, { data: learnings }, activeDomains] = await Promise.all([
        supabaseAdmin.from("outreach_enrolments").select("prospect_id").eq("campaign_id", campaign.id),
        supabaseAdmin.from("outreach_suppressions").select("target"),
        supabaseAdmin.from("outreach_prospects").select("*").in("status", ["imported", "queued"]).order("priority_score", { ascending: false }).limit(1000),
        supabaseAdmin.from("outreach_learnings").select("*").eq("campaign_id", campaign.id).eq("status", "promoted").limit(100),
        activeClientDomains(),
      ]);
      const used = new Set((enrolled || []).map((row: any) => row.prospect_id));
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
          activeClientDomains: activeDomains,
        }),
      })).sort((a: any, b: any) =>
        b.recommendation.score - a.recommendation.score ||
        String(a.prospect.company_name || "").localeCompare(String(b.prospect.company_name || ""))
      );
      for (const { prospect, recommendation } of ranked) {
        const email = String(prospect.email || "").toLowerCase();
        const domain = String(prospect.company_domain || "").toLowerCase();
        const companyKey = domain || String(prospect.company_name || "").toLowerCase();
        if (!email || used.has(prospect.id) || blocked.has(email) || blocked.has(domain) || activeDomains.has(domain)) continue;
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
        const { data: enrolment, error } = await supabaseAdmin.from("outreach_enrolments").insert({ campaign_id: campaign.id, prospect_id: prospect.id, queued_for: today, status: "queued", current_step: 1 }).select("id").single();
        if (error) throw error;
        await Promise.all([
          supabaseAdmin.from("outreach_prospects").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", prospect.id),
          supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: prospect.id, kind: "queued", metadata: { date: today, enrolment_id: enrolment.id } }),
        ]);
      }
    }
    const queue = await loadQueue();
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
