import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ---- Model selection ----
// LIVE track (this POC): Haiku 4.5 — fast + cheap, fires every 5s.
// PRO track (later): Sonnet/Opus + extended thinking, batched every ~30s.
//
// If you get a 404 "model not found", set the exact current string from
// console.anthropic.com in Vercel env (CLAUDE_MODEL_LIVE / CLAUDE_MODEL_PRO).
export const CLAUDE_MODEL_LIVE =
  process.env.CLAUDE_MODEL_LIVE || "claude-haiku-4-5";

export const CLAUDE_MODEL_PRO =
  process.env.CLAUDE_MODEL_PRO || "claude-sonnet-4-5";

// THINK track: the smartest model, for the success coach's high-leverage
// thinking (curriculum questions, growth-idea brainstorming, deal coaching,
// research-backed strategy). Idea quality is where the money is, so this earns
// the cost. Defaults to the PRO model so nothing 404s out of the box — set
// CLAUDE_MODEL_THINK to the exact Opus string from console.anthropic.com in
// Vercel env (e.g. an Opus 4.x model) to run the coach on Opus.
// THINK track: the smartest model for high-leverage thinking (research, the
// battlecard, deal coaching, strategy). Defaults to Claude Opus 4.8
// (claude-opus-4-8, $5/M in, $25/M out). Override via Vercel env.
export const CLAUDE_MODEL_THINK =
  process.env.CLAUDE_MODEL_THINK || "claude-opus-4-8";

// BRAIN track: the model the CRM assistant ("the brain" you chat with) uses for
// its SMART path (game-plans, deal coaching, drafting, strategy). Quick data
// lookups stay on the LIVE model. Runs on Claude Opus 4.8 (claude-opus-4-8) -
// switched off Fable 5 because Fable's rate limits were being hit and Opus 4.8 is
// cheaper ($5/$25 vs $10/$50) with higher limits. Override in Vercel env
// (e.g. CLAUDE_MODEL_BRAIN=claude-sonnet-5) to dial it back with no code change.
export const CLAUDE_MODEL_BRAIN =
  process.env.CLAUDE_MODEL_BRAIN || "claude-opus-4-8";
