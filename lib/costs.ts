// ============================================================
// Cost model — single source of truth for the running-cost meter.
// All rates in USD. Edit here if pricing changes.
//
// Verified provider rates (May 2026):
//   Deepgram streaming (Nova): $0.0077 / min  (PER audio stream)
//   GPT-5.6 Luna:  $1 / M input,  $6 / M output
//   GPT-5.6 Terra: $2.50 / M input, $15 / M output
//   GPT-5.6 Sol:   $5 / M input,  $30 / M output
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

  // GPT-5.6 Luna (live track: cues, plan, running summary)
  haikuInPerM: 1.0,
  haikuOutPerM: 6.0,
  haikuCacheReadPerM: 0.1, // 0.1x input
  haikuCacheWritePerM: 1.25, // 1.25x input

  // GPT-5.6 Terra (end-of-call scorecard and synthesis)
  sonnetInPerM: 2.5,
  sonnetOutPerM: 15.0,

  // GPT-5.6 Sol (the THINK tier + the brain's smart chat).
  opusInPerM: 5.0,
  opusOutPerM: 30.0,

  // Kept as a compatibility label for any older stored usage rows.
  fableInPerM: 5.0,
  fableOutPerM: 30.0,

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

  // End-of-call scorecard (Terra). Estimates for a typical call.
  scorecardIn: 12000, // transcript + competencies + rubric
  scorecardOut: 1800, // structured scorecard JSON

  // Live "statement" insight (Terra, periodic). Small: recent transcript +
  // cached knowledge + a short statement out.
  insightIn: 2600,
  insightOut: 180,
};

// Estimate OpenAI cost for ONE warm live suggestion call (Luna, cache warm).
export function openaiCallCostUSD(
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

// End-of-call scorecard on Terra (one call per interview).
export function scorecardCostUSD(): number {
  return (
    (TOKENS.scorecardIn / 1_000_000) * RATES.sonnetInPerM +
    (TOKENS.scorecardOut / 1_000_000) * RATES.sonnetOutPerM
  );
}

// One live "statement" insight on Terra (the advisory lane).
export function insightCostUSD(): number {
  return (
    (TOKENS.insightIn / 1_000_000) * RATES.sonnetInPerM +
    (TOKENS.insightOut / 1_000_000) * RATES.sonnetOutPerM
  );
}

// Exact cost of one OpenAI call from the usage object the API returns.
// Bills uncached input, cache-write (1.25x), cache-read (0.1x) and output at
// the model's real rates - no assumptions. This is what makes the meter
// accurate (a plan rebuild, a big scorecard, etc. each cost what they used).
export function usageCostUSD(
  model: "live" | "pro" | "think" | "brain",
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      }
    | null
    | undefined
): number {
  if (!usage) return 0;
  const inRate =
    model === "brain"
      ? RATES.fableInPerM
      : model === "think"
      ? RATES.opusInPerM
      : model === "pro"
      ? RATES.sonnetInPerM
      : RATES.haikuInPerM;
  const outRate =
    model === "brain"
      ? RATES.fableOutPerM
      : model === "think"
      ? RATES.opusOutPerM
      : model === "pro"
      ? RATES.sonnetOutPerM
      : RATES.haikuOutPerM;
  const inp = Number(usage.input_tokens) || 0;
  const out = Number(usage.output_tokens) || 0;
  const cw = Number(usage.cache_creation_input_tokens) || 0;
  const cr = Number(usage.cache_read_input_tokens) || 0;
  return (
    (inp / 1_000_000) * inRate +
    (cw / 1_000_000) * inRate * RATES.haikuCacheWritePerM +
    (cr / 1_000_000) * inRate * RATES.haikuCacheReadPerM +
    (out / 1_000_000) * outRate
  );
}

export type CostBreakdown = {
  deepgram: number;
  transport: number; // LiveKit (in-app) or Recall.ai (Meet)
  ai: number; // OpenAI live calls + pro scorecard
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
  // Number of Terra scorecard calls made (0 before the call ends, 1 after).
  sonnetCalls?: number;
  // Number of live Terra "statement" insight calls made.
  insightCalls?: number;
  // ACCURATE path: real accumulated OpenAI cost (USD) from token usage. When
  // provided, it replaces the count-based estimate entirely.
  aiUsd?: number;
};

// Live running estimate.
//   haikuCalls = number of Luna live calls made (cues + plan + running summary)
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

  // OpenAI cost. ACCURATE: if real usage-based cost is supplied, use it.
  // Otherwise fall back to the count-based estimate (legacy console).
  let ai = 0;
  if (typeof opts.aiUsd === "number") {
    ai = opts.aiUsd;
  } else {
    if (haikuCalls > 0) {
      const writeCost =
        (knowledgeTokens / 1_000_000) *
          RATES.haikuInPerM *
          RATES.haikuCacheWritePerM +
        ((TOKENS.transcriptWindow + TOKENS.instructions) / 1_000_000) *
          RATES.haikuInPerM +
        (TOKENS.output / 1_000_000) * RATES.haikuOutPerM;
      ai += writeCost;
      ai += (haikuCalls - 1) * openaiCallCostUSD(true, knowledgeTokens);
    }
    ai += sonnetCalls * scorecardCostUSD();
    ai += (opts.insightCalls ?? 0) * insightCostUSD();
  }

  const vercel = hours * RATES.vercelPerHour;
  const supabase = hours * RATES.supabasePerHour;

  const totalUSD = deepgram + transport + ai + vercel + supabase;
  return {
    deepgram,
    transport,
    ai,
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
