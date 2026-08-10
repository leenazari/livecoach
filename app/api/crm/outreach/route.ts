import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { activeClientDomains } from "@/lib/outreach";
import { scoreOutreachProspect } from "@/lib/outreach-scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
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
      supabaseAdmin.from("outreach_campaigns").select("*").eq("status", "active").order("created_at").limit(1),
      supabaseAdmin.from("outreach_learnings").select("*").eq("status", "promoted").limit(100),
      supabaseAdmin.from("outreach_suppressions").select("target"),
      activeClientDomains(),
    ]);
    const historyPromise = Promise.all([
      supabaseAdmin
        .from("outreach_messages")
        .select("id,prospect_id,status,subject,step_number,sent_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from("outreach_enrolments")
        .select("prospect_id,status,current_step,last_sent_at,next_action_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(2000),
    ]);
    const [{ data, error }, context, history] = await Promise.all([
      query,
      contextPromise,
      historyPromise,
    ]);
    if (error) throw error;
    const [{ data: campaigns }, { data: learnings }, { data: suppressions }, activeDomains] = context;
    const [{ data: messages }, { data: enrolments }] = history;
    const campaign = campaigns?.[0] || null;
    const campaignLearnings = (learnings || []).filter((learning: any) =>
      !campaign || learning.campaign_id === campaign.id
    );
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
    for (const enrolment of enrolments || []) {
      if (!latestEnrolment.has(enrolment.prospect_id))
        latestEnrolment.set(enrolment.prospect_id, enrolment);
    }
    const prospects = (data || [])
      .map((prospect: any) => ({
        ...prospect,
        outreach: {
          ...(messageSummary.get(prospect.id) || {
            latestMessage: null,
            latestSentMessage: null,
            sentCount: 0,
          }),
          enrolment: latestEnrolment.get(prospect.id) || null,
        },
        recommendation: scoreOutreachProspect(prospect, {
          campaign,
          learnings: campaignLearnings,
          blockedTargets,
          activeClientDomains: activeDomains,
        }),
      }))
      .sort((a: any, b: any) =>
        b.recommendation.score - a.recommendation.score ||
        String(a.company_name || "").localeCompare(String(b.company_name || ""))
      )
      .map((prospect: any) => {
        if (prospect.recommendation.action !== "contact_today") return prospect;
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
    return NextResponse.json({ prospects });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to load outreach prospects" }, { status: 500 });
  }
}
