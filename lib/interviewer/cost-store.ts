import "server-only";

import { supabaseService } from "@/lib/supabase";
import {
  llmUsd,
  sessionCost,
  ttsPreviewUsd,
  type CostRates,
} from "@/lib/interviewer/costs";

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadCostRates(): Promise<CostRates | null> {
  const { data, error } = await supabaseService
    .from("interviewer_config")
    .select("voice_agent_usd_per_minute, voice_agent_byo_usd_per_minute, use_byo_llm, listen_usd_per_minute, tts_usd_per_1k_chars, openai_input_usd_per_million, openai_output_usd_per_million, storage_usd_per_gb, vercel_usd_per_call, usd_to_gbp")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data || data.voice_agent_usd_per_minute == null) return null;
  return {
    voiceAgentUsdPerMinute: num(data.voice_agent_usd_per_minute, 0.075),
    voiceAgentByoUsdPerMinute: data.voice_agent_byo_usd_per_minute == null ? null : num(data.voice_agent_byo_usd_per_minute, 0),
    useByoLlm: data.use_byo_llm === true,
    listenUsdPerMinute: num(data.listen_usd_per_minute, 0.0077),
    ttsUsdPer1kChars: num(data.tts_usd_per_1k_chars, 0.015),
    openaiInputUsdPerMillion: num(data.openai_input_usd_per_million, 0.15),
    openaiOutputUsdPerMillion: num(data.openai_output_usd_per_million, 0.6),
    storageUsdPerGb: num(data.storage_usd_per_gb, 0.021),
    vercelUsdPerCall: num(data.vercel_usd_per_call, 0.0002),
    usdToGbp: num(data.usd_to_gbp, 0.79),
  };
}

export async function recordCostEvent(input: {
  workspaceId: string;
  campaignId: string | null;
  kind: "tts_preview" | "website_import" | "deck_vision";
  usd: number;
  detail: Record<string, unknown>;
}) {
  if (!(input.usd > 0)) return;
  const { error } = await supabaseService.from("interviewer_cost_events").insert({
    workspace_id: input.workspaceId,
    campaign_id: input.campaignId,
    kind: input.kind,
    usd_amount: input.usd,
    detail: input.detail,
  });
  if (error) console.error("interviewer cost event was not stored", { kind: input.kind });
}

export async function recordSessionCost(sessionId: string) {
  const rates = await loadCostRates();
  if (!rates) return;
  const { data: session, error } = await supabaseService
    .from("interviewer_sessions")
    .select("id, workspace_id, campaign_id, billable_seconds, recording_bytes")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !session) return;
  const { data: campaign } = await supabaseService
    .from("interviewer_campaigns")
    .select("rate_per_minute, currency")
    .eq("id", session.campaign_id)
    .maybeSingle();
  const cost = sessionCost({
    connectedSeconds: Number(session.billable_seconds || 0),
    recordingBytes: Number(session.recording_bytes || 0),
    ratePerMinute: Number(campaign?.rate_per_minute || 0),
    currency: String(campaign?.currency || "GBP"),
    rates,
  });
  await supabaseService.from("interviewer_session_costs").upsert({
    session_id: session.id,
    workspace_id: session.workspace_id,
    campaign_id: session.campaign_id,
    connected_seconds: cost.connectedSeconds,
    voice_agent_usd: cost.voiceAgentUsd,
    listen_usd: cost.listenUsd,
    llm_usd: 0,
    storage_usd: cost.storageUsd,
    vercel_usd: cost.vercelUsd,
    total_usd: cost.totalUsd,
    total_gbp: cost.totalGbp,
    revenue_gbp: cost.revenueGbp,
    margin_gbp: cost.marginGbp,
    margin_percent: cost.marginPercent,
  });
}

export { llmUsd, ttsPreviewUsd };
