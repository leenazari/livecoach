import { supabaseAdmin } from "@/lib/supabase";
import { usageCostUSD, USD_TO_GBP } from "@/lib/costs";

// One place to record every AI pass's cost so the dashboard can total true
// spend, not just live calls. Best-effort: never throws into the caller.
//
// IMPORTANT: do NOT log live-call passes here (cues, insights, running summary,
// end-of-call scorecard, and the plan built on the call screen). Those are
// already rolled into each call's saved total (interview_summaries.cost), so
// logging them again would double-count. Only log work done OUTSIDE the call:
// the CRM assistant, day reads, profile syntheses, task extraction, lessons.
export async function logUsage(
  kind: string,
  costGbp: number,
  meta: Record<string, any> = {}
): Promise<void> {
  if (!costGbp || costGbp < 0) costGbp = costGbp < 0 ? 0 : costGbp;
  try {
    await supabaseAdmin
      .from("usage_log")
      .insert({ kind, cost_gbp: costGbp, meta });
  } catch {
    /* best-effort */
  }
}

// Convenience: log straight from an Anthropic usage object.
export async function logModelUsage(
  kind: string,
  model: "haiku" | "sonnet" | "opus" | "fable",
  usage: any,
  meta: Record<string, any> = {}
): Promise<void> {
  const gbp = usageCostUSD(model, usage) * USD_TO_GBP;
  await logUsage(kind, gbp, { model, ...meta });
}
