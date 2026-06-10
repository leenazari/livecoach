import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

// Turns the INTENT of a call (the top-priority input) plus any supporting
// context (CV / JD / notes / researched background) into a plan: ranked focus
// areas, the character/outcome being sought, opening questions, and a playbook.
// Hardened so a slow or failed model call degrades to a usable plan instead of
// a 500 (which would blank the page).

// Cap supporting context so a big CV + researched background can't bloat the
// prompt and push the call past the time/size budget. The brief is never
// trimmed; only the secondary context is.
const MAX_CONTEXT_CHARS = 8000;

async function callModelWithTimeout(system: string, userMsg: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await anthropic.messages.create(
      {
        model: CLAUDE_MODEL_LIVE,
        max_tokens: 1200,
        system,
        messages: [{ role: "user", content: userMsg }],
      },
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { brief, role, knowledgeContext } = await req.json();

    let context = typeof knowledgeContext === "string" ? knowledgeContext : "";
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS) + "\n[context truncated]";
    }

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
5. playbook: 4-6 concrete, in-the-moment TACTICS tailored to THIS call type and intent - the practical moves the caller should be ready to make on the call. Each item is { "label": "short tactic name", "detail": "one specific, actionable line" }. Adapt the tactics to the call type:
   - sales / discovery: an opening discovery move, how to qualify (budget / authority / timeline), the single most likely objection and how to handle it, a buying-signal vs mere-politeness signal to watch for.
   - support: how to triage the issue, how to de-escalate if it turns tense, how to confirm the resolution actually landed.
   - interview: what "good" looks like for the top focus, a STAR probe to draw out real evidence, a common dodge to watch for.
   - general: how to build rapport, the key thing to clarify early, how to steer toward the goal without forcing it.
   Ground every tactic in the ACTUAL intent and context - never generic advice.

Output ONLY valid JSON (no markdown, no preamble):
{ "callType": "interview|sales|support|general", "subjectName": "...", "approach": { "goal": "...", "premise": "...", "strategy": "direct|warm-up-then-pivot", "pathway": ["..."] }, "focusAreas": ["..."], "character": "...", "openingQuestions": [{"q":"...","why":"...","opener":true}], "playbook": [{"label":"...","detail":"..."}] }`;

    const userMsg = `INTENT BRIEF (top priority): ${brief || "(none given)"}

ROLE / TITLE: ${role || "(not specified)"}

OPTIONAL SUPPORTING CONTEXT (document / notes about the person or topic):
${context || "(none provided)"}

Return the JSON plan now.`;

    // Try the model with a timeout; one quick retry on any failure. If both
    // attempts fail, fall through to a minimal plan rather than 500.
    let raw = "";
    let modelOk = false;
    for (let attempt = 0; attempt < 2 && !modelOk; attempt++) {
      try {
        const msg = await callModelWithTimeout(system, userMsg, 55000);
        raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
        modelOk = true;
      } catch (e) {
        console.error(`Plan model attempt ${attempt + 1} failed:`, e);
      }
    }

    let plan: any = {};
    try {
      plan = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      plan = {};
    }

    const focusAreas = Array.isArray(plan.focusAreas)
      ? plan.focusAreas
          .filter((x: any) => typeof x === "string" && x.trim())
          .slice(0, 10)
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
      openingQuestions = candidates.slice(0, 3).map((q: any) => ({
        q: q.q,
        why: typeof q.why === "string" ? q.why : "",
      }));
    }

    const playbook = Array.isArray(plan.playbook)
      ? plan.playbook
          .filter(
            (p: any) =>
              p &&
              typeof p.label === "string" &&
              typeof p.detail === "string" &&
              p.label.trim() &&
              p.detail.trim()
          )
          .slice(0, 6)
          .map((p: any) => ({ label: String(p.label), detail: String(p.detail) }))
      : [];

    return NextResponse.json({
      callType,
      subjectName,
      approach,
      focusAreas,
      character,
      openingQuestions,
      playbook,
    });
  } catch (err: any) {
    // Never 500 the page: return an empty-but-valid plan shape so the client
    // renders gracefully instead of throwing.
    console.error("Plan error:", err);
    return NextResponse.json({
      callType: "general",
      subjectName: "",
      approach: { goal: "", premise: "", strategy: "warm-up-then-pivot", pathway: [] },
      focusAreas: [],
      character: "",
      openingQuestions: [],
      playbook: [],
      degraded: true,
    });
  }
}
