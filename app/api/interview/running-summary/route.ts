import { NextRequest, NextResponse } from "next/server";
import {
  isTransientOpenAIError,
  openai,
  OPENAI_MODEL_LIVE,
} from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 30;

const cleanBullets = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .slice(0, 5);

const cleanCoverage = (value: unknown) => {
  const coverage: Record<string, number> = {};
  if (!value || typeof value !== "object") return coverage;
  for (const [key, raw] of Object.entries(value)) {
    const score = Math.round(Number(raw));
    if (key && Number.isFinite(score)) {
      coverage[key] = Math.max(0, Math.min(100, score));
    }
  }
  return coverage;
};

const cleanRunningSummary = (value: any) => ({
  context: cleanBullets(value?.context),
  signals: cleanBullets(value?.signals),
  concerns: cleanBullets(value?.concerns),
  coverage: cleanCoverage(value?.coverage),
});

// Maintains a LIVE running summary of the conversation as themed bullets
// (context / signals / concerns). Incremental: it's given the current bullets
// plus the conversation so far and folds in anything new. Cheap (Luna), runs
// on a light cadence off the cue's critical path.
export async function POST(req: NextRequest) {
  let fallback = cleanRunningSummary(null);
  try {
    const { transcript, previousBullets, focusAreas, role } = await req.json();
    fallback = cleanRunningSummary(previousBullets);

    if (!transcript || !String(transcript).trim()) {
      return NextResponse.json(fallback);
    }

    // Clamp the transcript here as well as on the client. The call screen sends
    // a trailing window, but this route is also reachable from anywhere else,
    // and an unbounded transcript on a lane that fires every couple of turns is
    // how this got expensive in the first place. previousBullets carries the
    // earlier history, so a trailing window loses nothing.
    const MAX_TRANSCRIPT_CHARS = 6000;
    const recent = String(transcript).slice(-MAX_TRANSCRIPT_CHARS);

    const prevText = JSON.stringify(fallback);

    const system = `You maintain a LIVE running summary of an ongoing conversation as short bullet points, grouped into three themes:
- "context": background and facts established about the person / situation.
- "signals": positive indicators - things that look GOOD for what the caller is trying to achieve.
- "concerns": risks, gaps, doubts, or things that look weak or are not yet addressed.

You are given the current bullets and the conversation so far. Return an UPDATED set that folds in anything new from the latest exchange.

Rules:
- A speaker label beginning "Team member" means an internal colleague. Keep their contribution distinct and never treat it as a buyer, candidate or client signal.
- Keep it tight: max 5 bullets per theme. Merge and dedupe; never repeat the same point twice.
- Each bullet is a short phrase (no trailing full stop), specific to THIS conversation - not generic.
- Preserve still-valid earlier bullets; refine rather than churn them.
- RETIRE RESOLVED CONCERNS: the moment the conversation answers or addresses something a concern flagged, REMOVE that concern entirely and move the fact into "context" (or "signals" if it's positive). NEVER keep a "not discussed / unclear / not yet addressed" bullet for something that has since been discussed. Re-check every existing concern against the latest exchange and drop any that no longer hold.
- A theme may be empty if nothing fits yet.
- Judge signals and concerns against what the caller cares about (their focus areas), not generic positivity.

Also rate COVERAGE: give a 0-100 score for EVERY focus area provided (never omit one - if a focus is genuinely untouched, score it 0, but you MUST include a key for every focus). Score how well the conversation SO FAR has addressed/explored each one:
- If the person has stated CONCRETE specifics for that focus - real numbers, a salary range, dates, named facts, or a clear yes/no/stance - that focus is well covered: score it 75-100. Do NOT leave it near 0 just because more detail could exist.
- Partial/vague mention = 30-60. Not touched at all = 0.
- Judge by what has ACTUALLY been said in the transcript, matching meaning, not exact keywords (e.g. a focus about "compensation" is covered when they discuss salary, bonus, relocation, package - even if the word "compensation" never appears).
Use each focus area's exact text as the key.

Output ONLY valid JSON (no markdown, no preamble):
{ "context": ["..."], "signals": ["..."], "concerns": ["..."], "coverage": { "<focus area>": 0-100 } }`;

    const user = `CALLER'S FOCUS AREAS (what matters most): ${
      Array.isArray(focusAreas) && focusAreas.length
        ? focusAreas.join(", ")
        : "(none specified)"
    }
ROLE / CONTEXT: ${role || "(not specified)"}

CURRENT BULLETS:
${prevText}

CONVERSATION SINCE THE LAST UPDATE (earlier history is already folded into the bullets above):
${recent}

Return the updated JSON bullets now.`;

    const msg = await openai.messages.create({
      model: OPENAI_MODEL_LIVE,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: user }],
    });

    const raw = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    let out: any = {};
    try {
      out = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      out = {};
    }

    return NextResponse.json(
      cleanRunningSummary(out),
      {
        headers: {
          "x-usage": JSON.stringify(msg.usage || {}),
          "x-model": "live",
        },
      }
    );
  } catch (err: any) {
    if (isTransientOpenAIError(err)) {
      console.warn("Running summary temporarily unavailable, preserving prior state");
      return NextResponse.json(fallback, {
        headers: {
          "Cache-Control": "no-store",
          "x-livecoach-degraded": "openai-temporary",
        },
      });
    }
    console.error("Running summary error:", err);
    return NextResponse.json(
      { error: err?.message || "summary failed" },
      { status: 500 }
    );
  }
}
