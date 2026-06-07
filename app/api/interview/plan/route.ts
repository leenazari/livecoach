import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// Turns the INTENT of a call (the top-priority input) plus any supporting
// context (CV / JD / notes) into a plan: ranked focus areas, the character /
// outcome being sought, and opening questions. The brief drives everything.
export async function POST(req: NextRequest) {
  try {
    const { brief, role, knowledgeContext } = await req.json();

    const system = `You are an expert interviewer and conversation planner. You are given the INTENT of an upcoming call plus any supporting context (a CV, job description, or notes).

The INTENT BRIEF is the TOP priority - it dictates what this call is really for and the kind of person or outcome the caller is driving toward. Supporting context (CV/JD) is secondary; when the brief and the context point in different directions, FOLLOW THE BRIEF.

There may be no CV or job description at all - in that case build the plan from the intent alone.

Produce a plan that drives the conversation toward the caller's intent:
1. focusAreas: 6-9 topics/competencies to assess or explore, RANKED most-important-first for THIS intent. Short keyword labels (1-4 words), specific to the intent - not generic filler.
2. character: 1-2 sentences describing the type of person / the outcome the caller is looking for, inferred from the intent (and JD if present).
3. openingQuestions: exactly 3 questions to OPEN the conversation, each as { "q": "...", "why": "short reason" }.
   An opener should ease the person in and surface their MOTIVATION, context, and what they care about - the kind of question you'd genuinely start a conversation with. Warm and inviting, one clear question each.
   Do NOT make openers hypothetical stress-tests, pressure scenarios (e.g. "how would you feel if I gave you X with no Y"), gotchas, or loaded multi-clause challenges - that kind of probing comes LATER in the conversation, never at the top. The first question especially must be the gentlest, most motivation-focused opener; order the three from gentlest to slightly more searching.

Output ONLY valid JSON (no markdown, no preamble):
{ "focusAreas": ["..."], "character": "...", "openingQuestions": [{"q":"...","why":"..."}] }`;

    const userMsg = `INTENT BRIEF (top priority): ${brief || "(none given)"}

ROLE / TITLE: ${role || "(not specified)"}

SUPPORTING CONTEXT (CV / job description / framework):
${knowledgeContext || "(none provided)"}

Return the JSON plan now.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const raw = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    let plan: any = {};
    try {
      plan = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      plan = {};
    }

    const focusAreas = Array.isArray(plan.focusAreas)
      ? plan.focusAreas.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 10)
      : [];
    const character = typeof plan.character === "string" ? plan.character : "";
    const openingQuestions = Array.isArray(plan.openingQuestions)
      ? plan.openingQuestions
          .filter((q: any) => q && typeof q.q === "string")
          .slice(0, 3)
      : [];

    return NextResponse.json({ focusAreas, character, openingQuestions });
  } catch (err: any) {
    console.error("Plan error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to build plan" },
      { status: 500 }
    );
  }
}
