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
    const { data, error } = await query;
    if (error) throw error;
    const [{ data: campaigns }, { data: learnings }, { data: suppressions }, activeDomains] = await contextPromise;
    const campaign = campaigns?.[0] || null;
    const campaignLearnings = (learnings || []).filter((learning: any) =>
      !campaign || learning.campaign_id === campaign.id
    );
    const blockedTargets = new Set(
      (suppressions || []).map((row: any) => String(row.target || "").toLowerCase())
    );
    const dailyLimit = Math.min(20, Math.max(1, Number(campaign?.daily_limit) || 20));
    let contactSlots = dailyLimit;
    const prospects = (data || [])
      .map((prospect: any) => ({
        ...prospect,
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
