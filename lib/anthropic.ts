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
