import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { DEFAULT_COST_RATES, money, sessionCost } from "@/lib/interviewer/costs";
import { loadCostRates } from "@/lib/interviewer/cost-store";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

type SessionRow = { id: string; billable_seconds: number | null; recording_bytes?: number | null; created_at: string };
type CostRow = {
  session_id: string;
  connected_seconds: number;
  voice_agent_usd: number;
  listen_usd: number;
  llm_usd: number;
  storage_usd: number;
  vercel_usd: number;
  total_gbp: number;
  revenue_gbp: number | null;
  margin_gbp: number | null;
  margin_percent: number | null;
};

export async function GET(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const campaignId = new URL(req.url).searchParams.get("campaignId") || "";
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      return NextResponse.json({ ready: false, calls: [], setup: [] }, { headers: noStore });
    }
    const sessions = await supabaseAdmin
      .from("interviewer_sessions")
      .select("id, billable_seconds, recording_bytes, created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(40);
    let sessionRows = (sessions.data || []) as SessionRow[];
    if (sessions.error && /recording_bytes|column|schema cache/i.test(sessions.error.message || "")) {
      const again = await supabaseAdmin
        .from("interviewer_sessions")
        .select("id, billable_seconds, created_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(40);
      sessionRows = (again.data || []) as SessionRow[];
    }
    const stored = await supabaseAdmin
      .from("interviewer_session_costs")
      .select("session_id, connected_seconds, voice_agent_usd, listen_usd, llm_usd, storage_usd, vercel_usd, total_gbp, revenue_gbp, margin_gbp, margin_percent")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId);
    const events = await supabaseAdmin
      .from("interviewer_cost_events")
      .select("kind, usd_amount, detail")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId);
    const rates = (await loadCostRates()) || DEFAULT_COST_RATES;
    const fx = rates.usdToGbp;
    const bySession = new Map<string, CostRow>();
    if (!stored.error) {
      for (const row of (stored.data || []) as CostRow[]) bySession.set(row.session_id, row);
    }
    const { data: campaign } = await supabaseAdmin
      .from("interviewer_campaigns")
      .select("rate_per_minute, currency")
      .eq("id", campaignId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    const calls = sessionRows.map((session) => {
      const row = bySession.get(session.id);
      if (row) {
        return {
          sessionId: session.id,
          createdAt: session.created_at,
          seconds: row.connected_seconds,
          estimated: false,
          cost: money(Number(row.total_gbp)),
          revenue: money(row.revenue_gbp == null ? null : Number(row.revenue_gbp), 2),
          margin: money(row.margin_gbp == null ? null : Number(row.margin_gbp), 2),
          marginPercent: row.margin_percent == null ? "—" : `${row.margin_percent}%`,
          voiceAgent: money(Number(row.voice_agent_usd) * fx),
          listen: money(Number(row.listen_usd) * fx),
          llm: Number(row.llm_usd) > 0 ? money(Number(row.llm_usd) * fx) : "Included in the Deepgram agent minute rate",
          storage: money(Number(row.storage_usd) * fx),
          vercel: money(Number(row.vercel_usd) * fx),
          totalGbp: Number(row.total_gbp || 0),
          revenueGbp: Number(row.revenue_gbp || 0),
        };
      }
      const estimate = sessionCost({
        connectedSeconds: Number(session.billable_seconds || 0),
        recordingBytes: Number(session.recording_bytes || 0),
        ratePerMinute: Number(campaign?.rate_per_minute || 0),
        currency: String(campaign?.currency || "GBP"),
        rates,
      });
      return {
        sessionId: session.id,
        createdAt: session.created_at,
        seconds: estimate.connectedSeconds,
        estimated: true,
        cost: money(estimate.totalGbp),
        revenue: money(estimate.revenueGbp, 2),
        margin: money(estimate.marginGbp, 2),
        marginPercent: estimate.marginPercent == null ? "—" : `${estimate.marginPercent}%`,
        voiceAgent: money(estimate.voiceAgentUsd * fx),
        listen: money(estimate.listenUsd * fx),
        llm: "Included in the Deepgram agent minute rate",
        storage: money(estimate.storageUsd * fx),
        vercel: money(estimate.vercelUsd * fx),
        totalGbp: estimate.totalGbp,
        revenueGbp: Number(estimate.revenueGbp || 0),
      };
    });
    const eventRows = events.error ? [] : events.data || [];
    const sumKind = (kind: string) => eventRows.filter((row) => row.kind === kind).reduce((sum, row) => sum + Number(row.usd_amount || 0), 0);
    const pages = eventRows.filter((row) => row.kind === "website_import").reduce((sum, row) => sum + Number((row.detail as { pages?: number } | null)?.pages || 0), 0);
    const slideCount = eventRows.filter((row) => row.kind === "deck_vision").reduce((sum, row) => sum + Number((row.detail as { slides?: number } | null)?.slides || 0), 0);
    const setup = [
      { kind: "Website import", detail: pages ? `${pages} pages fetched, no separate fetch charge` : "No scrape stored yet", amount: money(sumKind("website_import") * fx) },
      { kind: "Deck processing", detail: slideCount ? `${slideCount} slides` : "No deck stored yet", amount: money(sumKind("deck_vision") * fx) },
      { kind: "Voice previews", detail: "Cached samples", amount: money(sumKind("tts_preview") * fx) },
    ];
    const setupGbp = (sumKind("website_import") + sumKind("deck_vision") + sumKind("tts_preview")) * fx;
    const callGbp = calls.reduce((sum, call) => sum + call.totalGbp, 0);
    const revenue = calls.reduce((sum, call) => sum + call.revenueGbp, 0);
    const total = setupGbp + callGbp;
    const minutes = calls.reduce((sum, call) => sum + call.seconds, 0) / 60;
    return NextResponse.json({
      ready: !events.error || !stored.error || sessionRows.length > 0,
      ratesReady: Boolean(await loadCostRates()),
      label: "Internal: never share with clients",
      totals: {
        calls: calls.length,
        minutes: Math.round(minutes * 10) / 10,
        cost: money(total),
        setup: money(setupGbp),
        callsCost: money(callGbp),
        revenue: money(revenue, 2),
        margin: money(revenue - total, 2),
        marginPercent: revenue > 0 ? `${Math.round(((revenue - total) / revenue) * 1000) / 10}%` : "—",
        estimates: calls.some((call) => call.estimated),
      },
      setup,
      calls: calls.map(({ totalGbp: _total, revenueGbp: _revenue, ...call }) => call),
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
