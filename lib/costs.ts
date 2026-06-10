// ============================================================
// Cost model — single source of truth for the running-cost meter.
// All rates in USD. Edit here if pricing changes.
//
// Verified provider rates (May 2026):
//   Deepgram streaming (Nova): $0.0077 / min  (PER audio stream)
//   Claude Haiku 4.5:  $1 / M input,  $5 / M output
//   Claude Sonnet 4.6: $3 / M input, $15 / M output
//   Prompt cache read: ~0.1x input rate;  cache write: ~1.25x input rate
//
// ESTIMATED rates — VERIFY against real invoices before using in a financial
// document. These are derived to reconcile with the project's blended targets
// (~£2.2/hr in-app, ~£0.8/hr Meet), not taken from itemised bills:
//   LiveKit (in-app real-time, 2 participants audio):  ~$1.50 / hr
//   Recall.ai (Google Meet bot, incl. transcription):  ~$0.65 / hr
// ============================================================

export const USD_TO_GBP = 0.79; // rough; update as needed

export const RATES = {
  deepgramPerMin: 0.0077, // per stream

  // Haiku 4.5 (live track: cues, plan, running summary)
  haikuInPerM: 1.0,
  haikuOutPerM: 5.0,
  haikuCacheReadPerM: 0.1, // 0.1x input
  haikuCacheWritePerM: 1.25, // 1.25x input

  // Sonnet 4.6 (end-of-call scorecard only)
  sonnetInPerM: 3.0,
  sonnetOutPerM: 15.0,

  // Transport / real-time layer. ESTIMATES — verify against invoices.
  livekitPerHour: 1.5, // in-app two-party real-time
  recallPerHour: 0.65, // Google Meet bot incl. transcription

  // Rough infra overheads (estimates, not billed exactly).
  vercelPerHour: 0.2,
  supabasePerHour: 0.02,
};

// Token assumptions.
export const TOKENS = {
  knowledgeCached: 3000, // CV + framework, cached after first call (default)
  transcriptWindow: 320, // uncached new tokens per live call
  instructions: 220, // uncached system instructions
  output: 120, // typical live suggestion length

  // End-of-call scorecard (Sonnet). Estimates for a typical call.
  scorecardIn: 12000, // transcript + competencies + rubric
  scorecardOut: 1800, // structured scorecard JSON
};

// Estimate Claude cost for ONE warm live suggestion call (Haiku, cache warm).
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

// End-of-call scorecard on Sonnet (one call per interview).
export function scorecardCostUSD(): number {
  return (
    (TOKENS.scorecardIn / 1_000_000) * RATES.sonnetInPerM +
    (TOKENS.scorecardOut / 1_000_000) * RATES.sonnetOutPerM
  );
}

export type CostBreakdown = {
  deepgram: number;
  transport: number; // LiveKit (in-app) or Recall.ai (Meet)
  claude: number; // Haiku live calls + Sonnet scorecard
  vercel: number;
  supabase: number;
  totalUSD: number;
  totalGBP: number;
};

export type EstimateOpts = {
  // Actual loaded knowledge base size (CV + framework + uploaded docs), so a
  // bigger upload shows up in the meter instead of a fixed guess.
  knowledgeTokens?: number;
  // How many Deepgram streams are running. In-app two-party = 2; bot test = 1;
  // Meet = 0 (Recall.ai transcribes instead).
  deepgramStreams?: number;
  // Real-time transport in use. Drives the LiveKit/Recall.ai line.
  transport?: "none" | "livekit" | "recall";
  // Number of Sonnet scorecard calls made (0 before the call ends, 1 after).
  sonnetCalls?: number;
};

// Live running estimate.
//   haikuCalls = number of Haiku live calls made (cues + plan + running summary)
//   opts       = transport / stream / scorecard / knowledge-size context
export function estimateCost(
  elapsedSeconds: number,
  haikuCalls: number,
  opts: EstimateOpts = {}
): CostBreakdown {
  const knowledgeTokens = opts.knowledgeTokens ?? TOKENS.knowledgeCached;
  const deepgramStreams = opts.deepgramStreams ?? 1;
  const transportKind = opts.transport ?? "none";
  const sonnetCalls = opts.sonnetCalls ?? 0;

  const minutes = elapsedSeconds / 60;
  const hours = elapsedSeconds / 3600;

  // Transcription: one Deepgram bill per active stream.
  const deepgram = minutes * RATES.deepgramPerMin * deepgramStreams;

  // Real-time transport.
  let transport = 0;
  if (transportKind === "livekit") transport = hours * RATES.livekitPerHour;
  else if (transportKind === "recall") transport = hours * RATES.recallPerHour;

  // Claude: first Haiku call writes the cache, the rest are warm reads; the
  // scorecard is a separate Sonnet call.
  let claude = 0;
  if (haikuCalls > 0) {
    const writeCost =
      (knowledgeTokens / 1_000_000) *
        RATES.haikuInPerM *
        RATES.haikuCacheWritePerM +
      ((TOKENS.transcriptWindow + TOKENS.instructions) / 1_000_000) *
        RATES.haikuInPerM +
      (TOKENS.output / 1_000_000) * RATES.haikuOutPerM;
    claude += writeCost;
    claude += (haikuCalls - 1) * claudeCallCostUSD(true, knowledgeTokens);
  }
  claude += sonnetCalls * scorecardCostUSD();

  const vercel = hours * RATES.vercelPerHour;
  const supabase = hours * RATES.supabasePerHour;

  const totalUSD = deepgram + transport + claude + vercel + supabase;
  return {
    deepgram,
    transport,
    claude,
    vercel,
    supabase,
    totalUSD,
    totalGBP: totalUSD * USD_TO_GBP,
  };
}

export const HOURLY_CEILING_GBP = 3;

// Rough token estimate from raw text (~4 chars/token). Feeds the meter the real
// size of the loaded knowledge base.
export function knowledgeTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.round(text.length / 4);
}

// Project current spend to an hourly rate so the ceiling check is meaningful
// early in a call (not only after a full hour has elapsed).
export function projectHourlyGBP(
  totalGBP: number,
  elapsedSeconds: number
): number {
  if (elapsedSeconds < 30) return 0; // too little signal to project
  const hours = elapsedSeconds / 3600;
  return totalGBP / hours;
}
