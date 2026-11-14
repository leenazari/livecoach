import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { money } from "@/lib/interviewer/costs";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const campaignId = new URL(req.url).searchParams.get("campaignId") || "";
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      return NextResponse.json({ ready: false, calls: [] }, { headers: noStore });
    }
    const costs = await supabaseAdmin
      .from("interviewer_session_costs")
      .select("session_id, connected_seconds, voice_agent_usd, listen_usd, llm_usd, storage_usd, vercel_usd, total_gbp, revenue_gbp, margin_gbp, margin_percent")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (costs.error) return NextResponse.json({ ready: false, calls: [] }, { headers: noStore });
    const events = await supabaseAdmin
      .from("interviewer_cost_events")
      .select("kind, usd_amount")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId);
    const rows = costs.data || [];
    const minutes = rows.reduce((sum, row) => sum + Number(row.connected_seconds || 0), 0) / 60;
    const costGbp = rows.reduce((sum, row) => sum + Number(row.total_gbp || 0), 0);
    const eventUsd = (events.data || []).reduce((sum, row) => sum + Number(row.usd_amount || 0), 0);
    const rates = await supabaseAdmin.from("interviewer_config").select("usd_to_gbp").eq("id", 1).maybeSingle();
    const fx = Number(rates.data?.usd_to_gbp || 0.79);
    const revenue = rows.reduce((sum, row) => sum + Number(row.revenue_gbp || 0), 0);
    const totalCost = costGbp + eventUsd * fx;
    const margin = revenue - totalCost;
    return NextResponse.json({
      ready: true,
      label: "Internal: never share with clients",
      totals: {
        calls: rows.length,
        minutes: Math.round(minutes * 10) / 10,
        cost: money(totalCost),
        revenue: money(revenue, 2),
        margin: money(margin, 2),
        marginPercent: revenue > 0 ? `${Math.round((margin / revenue) * 1000) / 10}%` : "—",
      },
      calls: rows.map((row) => ({
        sessionId: row.session_id,
        seconds: row.connected_seconds,
        cost: money(Number(row.total_gbp)),
        revenue: money(row.revenue_gbp == null ? null : Number(row.revenue_gbp), 2),
        margin: money(row.margin_gbp == null ? null : Number(row.margin_gbp), 2),
        marginPercent: row.margin_percent == null ? "—" : `${row.margin_percent}%`,
        voiceAgent: money(Number(row.voice_agent_usd) * fx),
        listen: money(Number(row.listen_usd) * fx),
        storage: money(Number(row.storage_usd) * fx),
        vercel: money(Number(row.vercel_usd) * fx),
      })),
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
