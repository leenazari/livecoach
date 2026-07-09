import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// The newest Claude models (Opus 4.8, Sonnet 5, Fable 5, Mythos, and later)
// DEPRECATED the `temperature` parameter and return a 400
// ("`temperature` is deprecated for this model") if it is sent. Lots of routes
// still pass temperature, which broke the brain the moment it moved onto Opus
// 4.8. Rather than edit every call site, strip `temperature` centrally for those
// models on both messages.create and messages.stream. Older models that still
// accept it (Haiku 4.5, Sonnet 4.5/4.6) keep it, so cue/summary determinism is
// unchanged. Extend TEMP_DEPRECATED if a new family also drops it.
const TEMP_DEPRECATED =
  /(opus-4-[89]|opus-[5-9]|sonnet-[5-9]|fable|mythos)/i;
{
  const m: any = (anthropic as any).messages;
  const clean = (body: any) => {
    if (
      body &&
      typeof body === "object" &&
      "temperature" in body &&
      typeof body.model === "string" &&
      TEMP_DEPRECATED.test(body.model)
    ) {
      const { temperature, ...rest } = body;
      return rest;
    }
    return body;
  };
  if (typeof m.create === "function") {
    const origCreate = m.create.bind(m);
    m.create = (body: any, opts?: any) => origCreate(clean(body), opts);
  }
  if (typeof m.stream === "function") {
    const origStream = m.stream.bind(m);
    m.stream = (body: any, opts?: any) => origStream(clean(body), opts);
  }
}

// ---- Model selection ----
// Each tier reads a Vercel env override, else a sensible default.
//
// HARD STOP ON FABLE: Fable 5 is not used anywhere in this app (its cost and
// rate limits bit us). If any env var is set - or mis-set - to a Fable model,
// we IGNORE it and use the intended model for that tier, so no route can ever
// run Fable and quietly burn money. To actually change a tier, set its env var
// to a NON-Fable model. (Best fix is still to clear the Fable value in Vercel
// env, but this guarantees it can't cost you regardless.)
const pickModel = (envVal: string | undefined, fallback: string): string => {
  const v = (envVal || "").trim();
  if (!v || /fable/i.test(v)) return fallback;
  return v;
};

// LIVE track: Haiku 4.5 - fast + cheap, the high-frequency lanes (live cues,
// running summary, transcript condense, calendar sync, dashboard day-read).
export const CLAUDE_MODEL_LIVE = pickModel(
  process.env.CLAUDE_MODEL_LIVE,
  "claude-haiku-4-5"
);

// PRO track: Sonnet - the mid-tier passes (scorecard, the live advisor, plan,
// synthesize, prep-intent).
export const CLAUDE_MODEL_PRO = pickModel(
  process.env.CLAUDE_MODEL_PRO,
  "claude-sonnet-4-5"
);

// THINK track: the smartest model for high-leverage thinking (research, the
// battlecard, deal coaching, strategy). Defaults to Claude Opus 4.8
// (claude-opus-4-8, $5/M in, $25/M out).
export const CLAUDE_MODEL_THINK = pickModel(
  process.env.CLAUDE_MODEL_THINK,
  "claude-opus-4-8"
);

// BRAIN track: the CRM assistant's SMART path. Runs on Claude Opus 4.8 (moved
// off Fable 5 - Fable's limits/cost bit us). Quick lookups stay on LIVE.
export const CLAUDE_MODEL_BRAIN = pickModel(
  process.env.CLAUDE_MODEL_BRAIN,
  "claude-opus-4-8"
);
