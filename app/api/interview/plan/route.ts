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

    const system = `You are an expert conversation planner. You are given the INTENT of an upcoming conversation plus any optional supporting context (a CV, a document, notes about the person or topic).

The INTENT BRIEF is the TOP priority - it dictates what this conversation is for and what the caller is driving toward. The conversation could be ANY kind: a job interview, a sales call, a customer/support call, a discovery chat, etc. The intent tells you which. Supporting context is secondary; when the brief and the context disagree, FOLLOW THE BRIEF.

There may be no document at all - in that case build the plan from the intent alone.

Produce a plan that drives the conversation toward the caller's intent:
1. focusAreas: 6-9 topics/competencies to assess or explore, RANKED most-important-first for THIS intent. Short keyword labels (1-4 words), specific to the intent - not generic filler.
2. character: 1-2 sentences describing who/what the caller is looking for or the outcome they want from this conversation, inferred from the intent (and any document).
   Also determine:
   - callType: one of "interview", "sales", "support", or "general" - whichever best fits the intent.
   - subjectName: the name of the person/party being spoken with, if discernible from the intent or context; otherwise "".
3. approach: work out the SHAPE of the conversation so the live cues can follow a path, not just fire the destination question. Provide:
   - goal: the caller's real underlying purpose, in one sentence (e.g. "get them to consider a project-manager role").
   - premise: the assumption the goal depends on, AND whether it is established or unproven, in one sentence (e.g. "assumes they want to leave their current job - UNPROVEN, they have not said this"). If the goal assumes something the person has not actually signalled, say so explicitly.
   - strategy: either "direct" or "warm-up-then-pivot". Choose "warm-up-then-pivot" when the premise is unproven or the goal is sensitive/persuasive (a job move, a sale, a concession) - discover and build rapport first, then pivot. Choose "direct" only when the brief clearly invites directness or the premise is already established. IF THE BRIEF STATES A PREFERENCE (e.g. "ease in", "warm them up", "be direct", "get to the point"), FOLLOW THE BRIEF.
   - pathway: an ordered array of 3-5 short stage labels describing the route from rapport to purpose (e.g. ["build rapport", "surface what they value in their work", "probe ambitions / frustrations", "if a gap appears, introduce the alternative"]). The destination/purpose comes LAST, never first.
4. openingQuestions: 6 CANDIDATE questions to open the conversation, each as { "q": "...", "why": "short reason", "opener": true|false }.
   A true opener eases the person in and surfaces their MOTIVATION, context, and what they care about - warm and inviting, one clear question. Tag these "opener": true.
   Tag "opener": false for anything that is a hypothetical stress-test, pressure scenario (e.g. "how would you feel if I gave you X with no Y"), gotcha, or loaded multi-clause challenge - that probing belongs LATER in the conversation, never at the top.
   Provide AT LEAST 3 strong openers (opener:true). List the opener:true questions first, ordered gentlest -> slightly more searching.

Output ONLY valid JSON (no markdown, no preamble):
{ "callType": "interview|sales|support|general", "subjectName": "...", "approach": { "goal": "...", "premise": "...", "strategy": "direct|warm-up-then-pivot", "pathway": ["..."] }, "focusAreas": ["..."], "character": "...", "openingQuestions": [{"q":"...","why":"...","opener":true}] }`;

    const userMsg = `INTENT BRIEF (top priority): ${brief || "(none given)"}

ROLE / TITLE: ${role || "(not specified)"}

OPTIONAL SUPPORTING CONTEXT (document / notes about the person or topic):
${knowledgeContext || "(none provided)"}

Return the JSON plan now.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 1000,
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
    const allowedTypes = ["interview", "sales", "support", "general"];
    const callType = allowedTypes.includes(plan.callType)
      ? plan.callType
      : "general";
    const subjectName =
      typeof plan.subjectName === "string" ? plan.subjectName.trim() : "";
    const rawApproach =
      plan.approach && typeof plan.approach === "object" ? plan.approach : {};
    const approach = {
      goal: typeof rawApproach.goal === "string" ? rawApproach.goal : "",
      premise:
        typeof rawApproach.premise === "string" ? rawApproach.premise : "",
      strategy:
        rawApproach.strategy === "direct" ||
        rawApproach.strategy === "warm-up-then-pivot"
          ? rawApproach.strategy
          : "warm-up-then-pivot",
      pathway: Array.isArray(rawApproach.pathway)
        ? rawApproach.pathway
            .filter((x: any) => typeof x === "string" && x.trim())
            .slice(0, 6)
        : [],
    };
    // Filter opener candidates: keep only questions the model tagged as a real
    // opener AND that don't match an obvious stress-test / hypothetical pattern
    // (code-side safety net, so a mislabel still gets caught). Keep the top 3;
    // if none pass, fall back to the first candidates rather than return empty.
    const STRESS_PATTERN =
      /(if i (gave|give|asked|put|threw|handed)|how would (you|that) feel|how does that (make you )?feel|what if\b|imagine (you|that|a|having)|suppose (you|that)|hypothetical|what would you do if|picture (yourself|a))/i;

    const candidates: any[] = Array.isArray(plan.openingQuestions)
      ? plan.openingQuestions.filter((q: any) => q && typeof q.q === "string")
      : [];

    const graded = candidates.map((q: any) => ({
      q: q.q as string,
      why: typeof q.why === "string" ? q.why : "",
      isOpener: q.opener !== false && !STRESS_PATTERN.test(q.q),
    }));

    let openingQuestions = graded
      .filter((q) => q.isOpener)
      .slice(0, 3)
      .map(({ q, why }) => ({ q, why }));

    if (openingQuestions.length === 0) {
      openingQuestions = candidates
        .slice(0, 3)
        .map((q: any) => ({
          q: q.q,
          why: typeof q.why === "string" ? q.why : "",
        }));
    }

    return NextResponse.json({
      callType,
      subjectName,
      approach,
      focusAreas,
      character,
      openingQuestions,
    });
  } catch (err: any) {
    console.error("Plan error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to build plan" },
      { status: 500 }
    );
  }
}
