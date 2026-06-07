import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// Maintains a LIVE running summary of the conversation as themed bullets
// (context / signals / concerns). Incremental: it's given the current bullets
// plus the conversation so far and folds in anything new. Cheap (Haiku), runs
// on a light cadence off the cue's critical path.
export async function POST(req: NextRequest) {
  try {
    const { transcript, previousBullets, focusAreas, role } = await req.json();

    if (!transcript || !String(transcript).trim()) {
      return NextResponse.json({ context: [], signals: [], concerns: [] });
    }

    const prev =
      previousBullets && typeof previousBullets === "object"
        ? previousBullets
        : {};
    const prevText = JSON.stringify({
      context: Array.isArray(prev.context) ? prev.context : [],
      signals: Array.isArray(prev.signals) ? prev.signals : [],
      concerns: Array.isArray(prev.concerns) ? prev.concerns : [],
    });

    const system = `You maintain a LIVE running summary of an ongoing conversation as short bullet points, grouped into three themes:
- "context": background and facts established about the person / situation.
- "signals": positive indicators - things that look GOOD for what the caller is trying to achieve.
- "concerns": risks, gaps, doubts, or things that look weak or are not yet addressed.

You are given the current bullets and the conversation so far. Return an UPDATED set that folds in anything new from the latest exchange.

Rules:
- Keep it tight: max 5 bullets per theme. Merge and dedupe; never repeat the same point twice.
- Each bullet is a short phrase (no trailing full stop), specific to THIS conversation - not generic.
- Preserve still-valid earlier bullets; refine rather than churn them.
- A theme may be empty if nothing fits yet.
- Judge signals and concerns against what the caller cares about (their focus areas), not generic positivity.

Output ONLY valid JSON (no markdown, no preamble):
{ "context": ["..."], "signals": ["..."], "concerns": ["..."] }`;

    const user = `CALLER'S FOCUS AREAS (what matters most): ${
      Array.isArray(focusAreas) && focusAreas.length
        ? focusAreas.join(", ")
        : "(none specified)"
    }
ROLE / CONTEXT: ${role || "(not specified)"}

CURRENT BULLETS:
${prevText}

CONVERSATION SO FAR:
${transcript}

Return the updated JSON bullets now.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
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

    const clean = (a: any) =>
      Array.isArray(a)
        ? a.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 5)
        : [];

    return NextResponse.json({
      context: clean(out.context),
      signals: clean(out.signals),
      concerns: clean(out.concerns),
    });
  } catch (err: any) {
    console.error("Running summary error:", err);
    return NextResponse.json(
      { error: err?.message || "summary failed" },
      { status: 500 }
    );
  }
}
