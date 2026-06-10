// ============================================================
// Cost model — single source of truth for the running-cost meter.
// All rates in USD. Edit here if pricing changes.
// Verified rates (May 2026):
//   Deepgram streaming (Nova): $0.0077 / min
//   Claude Haiku 4.5:  $1 / M input,  $5 / M output
//   Claude Sonnet 4.6: $3 / M input, $15 / M output
//   Prompt cache read: ~0.1x input rate;  cache write: ~1.25x input rate
//   Voyage embeddings (voyage-3-lite): $0.02 / M  (not used in live loop)
// ============================================================

export const USD_TO_GBP = 0.79; // rough; update as needed

export const RATES = {
  deepgramPerMin: 0.0077,

  // Haiku 4.5 (live track)
  haikuInPerM: 1.0,
  haikuOutPerM: 5.0,
  haikuCacheReadPerM: 0.1, // 0.1x input
  haikuCacheWritePerM: 1.25, // 1.25x input

  // Rough infra overheads at ~720 calls/hr (1 user). Estimates, not billed exactly.
  vercelPerHour: 0.2,
  supabasePerHour: 0.02,
};

// Per-suggestion token assumptions for the live track.
export const TOKENS = {
  knowledgeCached: 3000, // CV + framework, cached after first call
  transcriptWindow: 320, // uncached new tokens per call
  instructions: 220, // uncached system instructions
  output: 120, // typical suggestion length
};

// Estimate Claude cost for ONE live suggestion call (with caching warm).
export function claudeCallCostUSD(
  cachingWarm: boolean,
  knowledgeTokens: number = TOKENS.knowledgeCached
): number {
  const inUncached = TOKENS.transcriptWindow + TOKENS.instructions;
  const knowledgeCost = cachingWarm
    ? (knowledgeTokens / 1_000_000) * RATES.haikuInPerM * RATES.haikuCacheReadPerM
    : (knowledgeTokens / 1_000_000) * RATES.haikuInPerM;
  const inputCost = (inUncached / 1_000_000) * RATES.haikuInPerM + knowledgeCost;
  const outputCost = (TOKENS.output / 1_000_000) * RATES.haikuOutPerM;
  return inputCost + outputCost;
}

export type CostBreakdown = {
  deepgram: number;
  claude: number;
  vercel: number;
  supabase: number;
  totalUSD: number;
  totalGBP: number;
};

// Live running estimate given elapsed seconds and number of Claude calls made.
export function estimateCost(
  elapsedSeconds: number,
  claudeCalls: number,
  knowledgeTokens: number = TOKENS.knowledgeCached
): CostBreakdown {
  const minutes = elapsedSeconds / 60;
  const deepgram = minutes * RATES.deepgramPerMin;

  // First call is a cache write, the rest are warm cache reads. knowledgeTokens
  // reflects the ACTUAL loaded knowledge base (CV + framework + any uploaded
  // doc), so a bigger upload shows up in the meter instead of a fixed guess.
  let claude = 0;
  if (claudeCalls > 0) {
    const writeCost =
      (knowledgeTokens / 1_000_000) *
        RATES.haikuInPerM *
        RATES.haikuCacheWritePerM +
      ((TOKENS.transcriptWindow + TOKENS.instructions) / 1_000_000) *
        RATES.haikuInPerM +
      (TOKENS.output / 1_000_000) * RATES.haikuOutPerM;
    claude += writeCost;
    claude += (claudeCalls - 1) * claudeCallCostUSD(true, knowledgeTokens);
  }

  const hours = elapsedSeconds / 3600;
  const vercel = hours * RATES.vercelPerHour;
  const supabase = hours * RATES.supabasePerHour;

  const totalUSD = deepgram + claude + vercel + supabase;
  return {
    deepgram,
    claude,
    vercel,
    supabase,
    totalUSD,
    totalGBP: totalUSD * USD_TO_GBP,
  };
}

export const HOURLY_CEILING_GBP = 3;


// Rough token estimate from raw text (~4 chars/token). Used to feed the meter
// the real size of the loaded knowledge base.
export function knowledgeTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.round(text.length / 4);
}

// Project the current spend to an hourly rate so the ceiling check is
// meaningful early in a call (not only after a full hour has elapsed).
export function projectHourlyGBP(
  totalGBP: number,
  elapsedSeconds: number
): number {
  if (elapsedSeconds < 30) return 0; // too little signal to project
  const hours = elapsedSeconds / 3600;
  return totalGBP / hours;
}
