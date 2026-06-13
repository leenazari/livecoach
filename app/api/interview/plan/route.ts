import { NextRequest, NextResponse } from "next/server";
import {
  anthropic,
  CLAUDE_MODEL_LIVE,
  CLAUDE_MODEL_PRO,
} from "@/lib/anthropic";

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
const MAX_CONTEXT_CHARS = 12000;

async function callModelWithTimeout(system: string, userMsg: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await anthropic.messages.create(
      {
        model: CLAUDE_MODEL_LIVE,
        // The STRUCTURAL plan runs on fast Haiku so it never times out against
        // the 60s function cap (the playbook is upgraded separately on Sonnet).
        // 2400 tokens leaves room for the full JSON without truncation.
        max_tokens: 2400,
        system,
        messages: [{ role: "user", content: userMsg }],
      },
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }
}

// Exact USD cost of one call from its usage (so the meter stays accurate even
// with the two-model split). Mirrors lib/costs usageCostUSD.
function callCostUSD(model: "haiku" | "sonnet", u: any): number {
  if (!u) return 0;
  const inR = model === "sonnet" ? 3 : 1;
  const outR = model === "sonnet" ? 15 : 5;
  const i = Number(u.input_tokens) || 0;
  const o = Number(u.output_tokens) || 0;
  const cw = Number(u.cache_creation_input_tokens) || 0;
  const cr = Number(u.cache_read_input_tokens) || 0;
  return (
    (i / 1e6) * inR +
    (cw / 1e6) * inR * 1.25 +
    (cr / 1e6) * inR * 0.1 +
    (o / 1e6) * outR
  );
}

// Tolerant JSON extraction. Haiku occasionally adds a prose preamble, wraps the
// JSON in ```fences```, or (if it ever truncates) leaves the tail unclosed.
// The old parser only stripped fences, so a preamble or truncation silently
// produced {} -> empty focusAreas -> blank plan panel. This recovers from all
// three: strip fences, slice to the outermost braces, parse; if that fails,
// trim the tail and rebalance brackets until it parses.
function extractPlan(raw: string): any {
  if (!raw) return null;
  let t = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  const core = start >= 0 && end > start ? t.slice(start, end + 1) : t;

  try {
    return JSON.parse(core);
  } catch {
    /* fall through to salvage */
  }

  // Tail-trim salvage for a truncated object: walk back from the end,
  // rebalancing any open [ and { , until a fragment parses.
  for (let cut = core.length; cut > 0; cut -= 1) {
    let frag = core.slice(0, cut).replace(/,\s*$/, "");
    const ob = (frag.match(/\{/g) || []).length;
    const cb = (frag.match(/\}/g) || []).length;
    const oa = (frag.match(/\[/g) || []).length;
    const ca = (frag.match(/\]/g) || []).length;
    frag += "]".repeat(Math.max(0, oa - ca)) + "}".repeat(Math.max(0, ob - cb));
    try {
      return JSON.parse(frag);
    } catch {
      /* keep trimming */
    }
  }
  return null;
}

// Last-resort: pull the focusAreas array out by regex even if the surrounding
// object can't be parsed at all. focusAreas gates the whole panel, so getting
// it back matters most.
function salvageFocusAreas(raw: string): string[] {
  const m = raw.match(/"focusAreas"\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

// Deterministic, no-model fallback so a plan ALWAYS builds - even if the model
// is unreachable (bad key, quota, timeout). Generic by design; the UI flags it
// as degraded so the user knows to rebuild for a tailored plan.
function inferCallType(
  brief: string
): "interview" | "sales" | "support" | "general" {
  const b = (brief || "").toLowerCase();
  if (
    /(sell|sale|sales|buyer|deal|pricing|quote|demo|prospect|client|customer|pipeline|close|proposal|vendor|discovery)/.test(
      b
    )
  )
    return "sales";
  if (
    /(interview|candidate|hire|hiring|cv|resume|competenc|applicant|recruit)/.test(
      b
    )
  )
    return "interview";
  if (
    /(support|issue|bug|ticket|complaint|broken|error|troubleshoot|outage|fault)/.test(
      b
    )
  )
    return "support";
  return "general";
}

function buildFallback(brief: string, role: string, callTypeIn: string) {
  const callType =
    callTypeIn && callTypeIn !== "general"
      ? (callTypeIn as "interview" | "sales" | "support" | "general")
      : inferCallType(brief);

  const FOCUS: Record<string, string[]> = {
    sales: [
      "pain points",
      "current solution",
      "budget",
      "decision process",
      "timeline",
      "success criteria",
      "objections",
    ],
    interview: [
      "motivation",
      "relevant experience",
      "ownership & impact",
      "problem solving",
      "collaboration",
      "role fit",
      "communication",
    ],
    support: [
      "issue summary",
      "impact & severity",
      "steps to reproduce",
      "what's been tried",
      "environment",
      "desired outcome",
      "urgency",
    ],
    general: [
      "context",
      "goals",
      "priorities",
      "constraints",
      "decision criteria",
      "next steps",
      "open questions",
    ],
  };

  const PLAYBOOK: Record<string, { label: string; detail: string }[]> = {
    sales: [
      { label: "Open with discovery", detail: "Ask what prompted them to look now - surface the real trigger before pitching." },
      { label: "Qualify", detail: "Confirm budget, who decides, and timeline early so you don't chase a dead deal." },
      { label: "Handle the likely objection", detail: "Pre-empt 'too expensive / not now' by anchoring on the cost of their current pain." },
      { label: "Watch for buying signals", detail: "Specific next-step or implementation questions = real interest, not politeness." },
    ],
    interview: [
      { label: "Define good", detail: "Know what a strong answer on the top focus looks like before you ask." },
      { label: "STAR probe", detail: "When they give a result, ask what THEY personally did to get it." },
      { label: "Watch for dodges", detail: "Vague 'we' answers - gently redirect to their specific contribution." },
      { label: "Stay warm", detail: "Lead with curiosity, not interrogation - you get fuller answers." },
    ],
    support: [
      { label: "Triage first", detail: "Pin down impact and severity before diving into fixes." },
      { label: "De-escalate", detail: "Acknowledge the frustration explicitly before troubleshooting." },
      { label: "Reproduce", detail: "Get exact steps and environment so the fix is real, not a guess." },
      { label: "Confirm resolution", detail: "Verify with the user that it actually landed before closing." },
    ],
    general: [
      { label: "Build rapport", detail: "Open warm and let them set context before you steer." },
      { label: "Clarify early", detail: "Pin down the one thing that matters most to them up front." },
      { label: "Steer gently", detail: "Move toward your goal without forcing it - follow their threads." },
      { label: "Land next steps", detail: "Close with a concrete, agreed next action." },
    ],
  };

  const OPENERS: Record<string, { q: string; why: string }[]> = {
    sales: [
      { q: "What prompted you to start looking into this now?", why: "surfaces the trigger" },
      { q: "How are you handling this today?", why: "maps the status quo" },
      { q: "What would a good outcome look like for you?", why: "defines success" },
    ],
    interview: [
      { q: "What's drawing you to this role?", why: "motivation" },
      { q: "Walk me through what you're working on now.", why: "context" },
      { q: "What kind of work do you do your best in?", why: "fit" },
    ],
    support: [
      { q: "Can you walk me through what's happening?", why: "issue summary" },
      { q: "When did you first notice it?", why: "scope & timeline" },
      { q: "What were you trying to do when it went wrong?", why: "reproduce" },
    ],
    general: [
      { q: "What's the main thing you're hoping to get out of this?", why: "goal" },
      { q: "Can you give me a bit of background?", why: "context" },
      { q: "What matters most to you here?", why: "priorities" },
    ],
  };

  const PATHWAY: Record<string, string[]> = {
    sales: ["build rapport", "discover the pain", "qualify fit & budget", "introduce the solution"],
    interview: ["build rapport", "explore motivation", "probe experience & ownership", "assess role fit"],
    support: ["acknowledge & calm", "understand the issue", "diagnose", "confirm resolution"],
    general: ["build rapport", "understand context", "surface priorities", "steer toward the goal"],
  };

  const character =
    role && role.trim()
      ? `A ${callType} conversation${role ? ` around ${role.trim()}` : ""}. (Generic plan - rebuild for one tailored to your brief.)`
      : `A ${callType} conversation. (Generic plan - rebuild for one tailored to your brief.)`;

  return {
    callType,
    subjectName: "",
    approach: {
      goal: brief ? String(brief).slice(0, 160) : "",
      premise: "Built without the planner model - treat as a starting point.",
      strategy: "warm-up-then-pivot" as const,
      pathway: PATHWAY[callType],
    },
    focusAreas: FOCUS[callType],
    character,
    openingQuestions: OPENERS[callType],
    playbook: PLAYBOOK[callType],
    privateNotes: [],
    goals: [],
  };
}

export async function POST(req: NextRequest) {
  let brief = "";
  let role = "";
  try {
    const body = await req.json();
    brief = typeof body.brief === "string" ? body.brief : "";
    role = typeof body.role === "string" ? body.role : "";
    const knowledgeContext = body.knowledgeContext;
    const curatedFocus: string[] = Array.isArray(body.focusAreas)
      ? body.focusAreas
          .filter((x: any) => typeof x === "string" && x.trim())
          .slice(0, 12)
      : [];

    let context = typeof knowledgeContext === "string" ? knowledgeContext : "";
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS) + "\n[context truncated]";
    }

    // STEP 1 of the two-step build: focus areas only. A small, fast Haiku call
    // so the caller can lock/edit focus BEFORE we spend on the heavy full plan
    // (questions + playbook + goals). Returns callType, subjectName, a quick
    // read, and the ranked focus list - nothing else.
    if (body.focusOnly === true) {
      // When the caller already has a focus list and is REBUILDING after adding
      // a document, reconcile against it instead of deriving from scratch - so
      // the model judges overlap by MEANING and never produces near-duplicates.
      const existingFocus: string[] = Array.isArray(body.existingFocus)
        ? body.existingFocus
            .filter((x: any) => typeof x === "string" && x.trim())
            .map((x: string) => x.trim())
            .slice(0, 12)
        : [];
      const reconcile = existingFocus.length > 0;

      const deriveSystem = `You are an expert conversation planner. From the INTENT brief and any supporting document, return ONLY this and nothing else:
- callType: one of "interview", "sales", "support", "general".
- subjectName: the person/party being spoken with if discernible from the brief/context, else "".
- focusAreas: 6-9 topics to assess or explore, RANKED most-important-first. Tight labels (2-5 words) that are CONCRETE and SPECIFIC TO THIS CALL - name the actual idea, product, people, numbers or mechanics from the brief and document. A reader should be UNABLE to use them for any other call. BANNED generic filler: "Phase 1 deliverables", "Timeline and resources", "Data privacy", "Decision authority", "Content integration". GOOD (for a relationship-AI built from 100 books, a YouTube audience, a 50/50 JV): "how the 100 books shape replies", "therapy-avatar emotional realism", "YouTube 9.7M launch fit", "JV 50/50 terms", "consent for sensitive relationship data". Every focus must be appropriate to raise OPENLY with the other party - never the caller's own internal/sensitive matters.
- character: 1-2 sentences - the caller's read on who/what they're dealing with and what they want from this call.

Output ONLY valid JSON: { "callType": "...", "subjectName": "...", "focusAreas": ["..."], "character": "..." }`;

      const reconcileSystem = `You are an expert conversation planner RECONCILING the caller's EXISTING focus list against new information (a freshly added document plus the intent). Return ONLY JSON.

EXISTING FOCUS LIST - the caller has ranked and edited these; treat them as the source of truth and do NOT restate them:
${existingFocus.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Produce:
- additions: 0-5 GENUINELY NEW focus topics the document/intent surface that are NOT already covered, even loosely, by any existing focus. Judge overlap by MEANING, not wording - if a topic is already represented by an existing focus, DO NOT add it. Tight labels (2-5 words), concrete and specific to THIS call. Empty array if the document adds nothing new.
- upgrades: 0-3 in-place improvements. ONLY when the new information yields a CLEARLY more specific / better version of an EXISTING focus. Each is {"from":"<copy the existing focus label VERBATIM from the list above>","to":"<the improved, more specific label>"}. Do NOT upgrade unless it is clearly better. Never list a focus in both additions and upgrades.
- callType: one of "interview", "sales", "support", "general".
- subjectName: the person/party being spoken with if discernible, else "".
- character: 1-2 sentences - the caller's read on who/what they're dealing with.

CRITICAL - NO DUPLICATES: an addition must not overlap any existing focus OR another addition. When in doubt, prefer an upgrade over an addition, or leave it out entirely.

Output ONLY valid JSON: { "additions": ["..."], "upgrades": [{"from":"...","to":"..."}], "callType":"...", "subjectName":"...", "character":"..." }`;

      const fSystem = reconcile ? reconcileSystem : deriveSystem;
      const fUser = `INTENT BRIEF (top priority): ${brief || "(none given)"}
ROLE / TITLE: ${role || "(not specified)"}

SUPPORTING CONTEXT - the substance of this call:
${context || "(none provided)"}

Return the JSON now.`;
      let fUsage: any = null;
      let fRaw = "";
      try {
        const fMsg = await callModelWithTimeout(fSystem, fUser, 25000);
        fUsage = fMsg.usage;
        fRaw = fMsg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
      } catch (e) {
        console.error("Focus-only model call failed:", e);
      }
      const fPlan = extractPlan(fRaw) || {};
      const fCallType = ["interview", "sales", "support", "general"].includes(
        fPlan.callType
      )
        ? fPlan.callType
        : "general";
      const fSubject =
        typeof fPlan.subjectName === "string" ? fPlan.subjectName.trim() : "";
      const fCharacter =
        typeof fPlan.character === "string" ? fPlan.character : "";
      const costHeader = { "x-cost-usd": String(callCostUSD("haiku", fUsage)) };

      // RECONCILE: return additions + in-place upgrades, deduped by meaning.
      if (reconcile) {
        const additions: string[] = Array.isArray(fPlan.additions)
          ? fPlan.additions
              .filter((x: any) => typeof x === "string" && x.trim())
              .map((x: string) => x.trim())
              .slice(0, 6)
          : [];
        const upgrades = Array.isArray(fPlan.upgrades)
          ? fPlan.upgrades
              .filter(
                (u: any) =>
                  u &&
                  typeof u.from === "string" &&
                  typeof u.to === "string" &&
                  u.from.trim() &&
                  u.to.trim()
              )
              .map((u: any) => ({
                from: String(u.from).trim(),
                to: String(u.to).trim(),
              }))
              .slice(0, 5)
          : [];
        return NextResponse.json(
          {
            callType: fCallType,
            subjectName: fSubject,
            character: fCharacter,
            additions,
            upgrades,
            focusOnly: true,
            reconcile: true,
            degraded: false,
          },
          { headers: costHeader }
        );
      }

      let fFocus = Array.isArray(fPlan.focusAreas)
        ? fPlan.focusAreas
            .filter((x: any) => typeof x === "string" && x.trim())
            .slice(0, 10)
        : [];
      if (fFocus.length === 0) fFocus = salvageFocusAreas(fRaw).slice(0, 10);
      if (fFocus.length === 0) {
        const fb = buildFallback(brief, role, fCallType);
        return NextResponse.json(
          {
            callType: fb.callType,
            subjectName: fb.subjectName,
            focusAreas: fb.focusAreas,
            character: fb.character,
            focusOnly: true,
            degraded: true,
          },
          { headers: costHeader }
        );
      }
      return NextResponse.json(
        {
          callType: fCallType,
          subjectName: fSubject,
          focusAreas: fFocus,
          character: fCharacter,
          focusOnly: true,
          degraded: false,
        },
        { headers: costHeader }
      );
    }

    const system = `You are an expert conversation planner. You are given the INTENT of an upcoming conversation plus any optional supporting context (a CV, a document, notes about the person or topic).

The INTENT BRIEF defines the GOAL of the call and what KIND of call it is (interview, sales, support, discovery, general). Use it to set the goal, the call type, and the caller's angle.

Any SUPPORTING CONTEXT below - an uploaded document, a researched page, notes - is the SUBSTANCE the conversation is actually about. When a document is provided, it almost always contains the specific idea, product, company, or person at the centre of this call. TREAT THE DOCUMENT AS PRIMARY SUBJECT MATTER: weave its concrete specifics - real names, the actual idea/product, its claims, numbers and details - directly into the focus areas, the read, and especially the playbook. Do NOT produce generic call advice that ignores the document; a reader should be able to tell the plan was built for THIS document and no other. The brief often refers to the idea only vaguely (e.g. "his idea", "the thing we discussed") - the DOCUMENT is where that idea is actually defined, so connect the two. Only override a document detail when it directly contradicts the brief's stated intent.

There may be no document at all - in that case build the plan from the intent alone.

Produce a plan that drives the conversation toward the caller's intent:
1. focusAreas: 6-9 topics/competencies to assess or explore, RANKED most-important-first for THIS intent. Tight labels (2-5 words) that are CONCRETE and SPECIFIC TO THIS CALL - name the actual idea, product, people, numbers, or mechanics from the brief and document. A reader should be UNABLE to use these focus areas for any other call. BANNED: generic consulting filler like "Phase 1 deliverables", "Timeline and resources", "Data privacy", "Decision authority and next steps", "Content integration" - these could apply to anything and are useless. INSTEAD anchor each to the real subject. Example - for a relationship-AI companion built from someone's 100 books, with a YouTube audience and a 50/50 JV: BAD = "Content integration", "Timeline and resources", "Data privacy"; GOOD = "how the 100 books shape replies", "therapy-avatar emotional realism", "YouTube 9.7M launch fit", "JV 50/50 terms", "consent for sensitive relationship data", "scope of Phase 1 scenarios". Keep them short, but every label must carry a specific from THIS conversation. These are topics you will explore OPENLY with the other party in the room, so EVERY focus area must be appropriate to raise in front of them. NEVER put the caller's own internal or sensitive matters here - their own team's capacity, their own staff's availability, their own costs/margins, their negotiating limits or walk-away, internal doubts. Those are private and go in privateNotes (item 6), never in a focus area the live cues will push you to ask about.
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
   Provide AT LEAST 3 strong openers (opener:true). List the opener:true questions first, ordered gentlest -> slightly more searching. Every opening question must be one you would be comfortable asking with everyone in the room - never about the caller's own internal matters or position.
5. playbook: 4-6 concrete, in-the-moment TACTICS tailored to THIS call type and intent - the practical moves the caller should be ready to make on the call. Each item is { "label": "short tactic name", "detail": "one specific, actionable line" }. Adapt the tactics to the call type:
   - sales / discovery: an opening discovery move, how to qualify (budget / authority / timeline), the single most likely objection and how to handle it, a buying-signal vs mere-politeness signal to watch for.
   - support: how to triage the issue, how to de-escalate if it turns tense, how to confirm the resolution actually landed.
   - interview: what "good" looks like for the top focus, a STAR probe to draw out real evidence, a common dodge to watch for.
   - general: how to build rapport, the key thing to clarify early, how to steer toward the goal without forcing it.
   Ground every tactic in the ACTUAL intent AND the specifics of the uploaded document - reference the real idea/product/person by name. Never generic advice that could apply to any call.
   TONE (important - the detail is for a real human to say warmly): write each tactic the way a thoughtful, friendly, intellectually-curious partner would - warm, collaborative, softened. If you suggest something to SAY, phrase it as a warm person actually would: inviting and curious, NOT a scripted command, ultimatum, or directive. Give the MOVE plus a friendly way to make it, so the host adapts it in their own voice. BAN bossy/blunt openers like "I want you to...", "Before we talk X, I want to be clear...", "That's your role here", "explicitly say:". Lead with curiosity and partnership, never control. This is a conversation between collaborators, not a sales script.

6. privateNotes: 0-5 things the caller should KEEP IN MIND but must NOT say or raise on the call with the other party present - their own internal constraints, sensitivities, leverage, or risks (e.g. "your team is already at capacity - don't signal this to them", "your real walk-away is X", "keep Mark's limited availability internal"). For the caller's eyes only; these NEVER become focus areas, questions, or cues. Empty array if there are none.
7. goals: 3-6 SHORT, concrete outcomes the caller should work TOWARD on this call - what "a good call" looks like (e.g. "agree Phase 1 scope", "understand the therapeutic value of the books", "confirm who has final say"). Tickable objectives in plain words, ranked most-important-first. These pre-populate the caller's live goal checklist.

Output ONLY valid JSON (no markdown, no preamble):
{ "callType": "interview|sales|support|general", "subjectName": "...", "approach": { "goal": "...", "premise": "...", "strategy": "direct|warm-up-then-pivot", "pathway": ["..."] }, "focusAreas": ["..."], "character": "...", "openingQuestions": [{"q":"...","why":"...","opener":true}], "playbook": [{"label":"...","detail":"..."}], "privateNotes": ["..."], "goals": ["..."] }`;

    const userMsg = `INTENT BRIEF (top priority): ${brief || "(none given)"}

ROLE / TITLE: ${role || "(not specified)"}
${
  curatedFocus.length
    ? `\nFIXED FOCUS AREAS - the caller has ALREADY chosen and RANKED these. Use EXACTLY these as the "focusAreas" (do NOT add, remove, merge, or reorder them), and build the read/character, opening questions, playbook AND goals AROUND them, in this exact priority order:\n${curatedFocus
        .map((f, i) => `${i + 1}. ${f}`)
        .join("\n")}

THE FOCUS LIST IS THE COMPLETE AGENDA - HARD BOUNDARY:
- Every opening question and every playbook tactic MUST serve one of the focus areas above. Nothing else is on the table.
- The caller has DELIBERATELY chosen what is in and what is out. Do NOT raise, open on, or reference any topic that is not one of these focus areas - even if the supporting document makes it prominent, impressive, or tempting (a big audience, a headline number, a famous name, a juicy aside). If a fact from the document is not tied to one of the focus areas, leave it OUT entirely.
- Example of the trap to avoid: the document mentions a large social following or a flashy metric, but it is NOT a focus area - then NO question or tactic may mention it. Treat anything outside the focus list as off-limits for this call.\n`
    : ""
}
SUPPORTING CONTEXT - uploaded document(s) / researched background / notes. This is the substance of what the call is about; use it heavily and specifically:
${context || "(none provided)"}

Return the JSON plan now.`;

    // HARD TIME BUDGET. The function is killed by the platform at 60s, and that
    // kill returns a non-JSON error page ("An error occurred...") which the
    // client cannot parse. So we self-police: every model call is bounded by
    // the time REMAINING before a 52s deadline (8s headroom), and we skip a
    // stage rather than overrun. This guarantees we always return clean JSON.
    const DEADLINE = Date.now() + 52000;
    const remaining = () => DEADLINE - Date.now();

    // Fast Haiku structural plan: ONE attempt that uses most of the budget,
    // reserving ~14s for the separate Sonnet playbook. Two short attempts were
    // worse - if the model needs ~35s, both 28s attempts time out and we get
    // nothing; a single long attempt finishes. A failure here is covered by the
    // deterministic backfill further down, so a retry buys little.
    let raw = "";
    let planUsage: any = null;
    let pbUsage: any = null;
    {
      const ms = Math.min(42000, remaining() - 14000);
      try {
        const msg = await callModelWithTimeout(system, userMsg, ms);
        raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
        planUsage = msg.usage;
      } catch (e) {
        console.error("Plan model attempt failed:", e);
      }
    }

    const plan: any = extractPlan(raw) || {};

    let focusAreas = Array.isArray(plan.focusAreas)
      ? plan.focusAreas
          .filter((x: any) => typeof x === "string" && x.trim())
          .slice(0, 10)
      : [];
    // If parsing dropped the array, try to recover it directly from the text.
    if (focusAreas.length === 0) {
      focusAreas = salvageFocusAreas(raw).slice(0, 10);
    }
    // If the caller supplied a curated/ranked focus, that is authoritative -
    // the rest of the plan was built around it; keep their exact list & order.
    if (curatedFocus.length > 0) {
      focusAreas = curatedFocus.slice(0, 10);
    }

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

    const haikuPlaybook = Array.isArray(plan.playbook)
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

    // PLAYBOOK on the high-quality model. A small, focused Sonnet pass (fast)
    // so the tactics are sharp, warm and specific, WITHOUT putting the whole
    // slow plan on Sonnet. If it fails/times out, keep the fast Haiku playbook.
    let sonnetPlaybook: { label: string; detail: string }[] = [];
    // Only attempt the Sonnet upgrade if there's real budget left; otherwise
    // keep the Haiku playbook. This is what stops the 60s overrun.
    try {
      if (remaining() < 9000) throw new Error("skip Sonnet - low budget");
      const pbSystem: any[] = [
        {
          type: "text",
          text: `You write the PLAYBOOK for a live call: 4-6 concrete, in-the-moment tactics the caller should be ready to use. Each item is { "label": "short tactic name", "detail": "one specific, actionable line" }.

Ground EVERY tactic in THIS call - name the real idea, product, and people from the intent, the FOCUS AREAS, and the document. A reader should be unable to use these tactics for any other call. Never generic advice.

THE FOCUS AREAS ARE A HARD BOUNDARY: every tactic MUST serve one of the focus areas given below. Do NOT build a tactic around any topic, fact, or number from the document that is not one of the focus areas - even if it is prominent or impressive (a big audience, a headline metric, a famous name). The caller deliberately chose what is in scope; anything outside the focus areas is OFF-LIMITS for this call. Only cite a number if it belongs to a focus area.

TONE - the detail is for a real human to say WARMLY: write each tactic the way a thoughtful, friendly, intellectually-curious partner would - warm, collaborative, softened, leading with curiosity. If you suggest something to SAY, phrase it as a warm person actually would: inviting, never a scripted command or ultimatum. BAN bossy openers like "I want you to...", "Before we talk X, I want to be clear...", "That's your role here", "explicitly say:". This is a conversation between collaborators, not a sales script.

Output ONLY a JSON array: [{"label":"...","detail":"..."}] - no prose, no markdown.`,
        },
        {
          type: "text",
          text: `CONTEXT - the subject of this call:\n\n${
            context || "(none provided)"
          }`,
          cache_control: { type: "ephemeral" },
        },
      ];
      const pbUser = `INTENT: ${brief || "(none given)"}
ROLE / TITLE: ${role || "(not specified)"}
RANKED FOCUS AREAS: ${focusAreas.join(", ")}
YOUR READ ON THEM: ${character || "(n/a)"}

Write the 4-6 tactic playbook now - JSON array only.`;
      const pbController = new AbortController();
      const pbMs = Math.min(25000, remaining() - 3000);
      const pbTimer = setTimeout(() => pbController.abort(), pbMs);
      try {
        const pbMsg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 900,
            temperature: 0.5,
            system: pbSystem,
            messages: [{ role: "user", content: pbUser }],
          },
          { signal: pbController.signal }
        );
        pbUsage = pbMsg.usage;
        const pbRaw = pbMsg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .replace(/```json|```/g, "")
          .trim();
        const a = pbRaw.indexOf("[");
        const b = pbRaw.lastIndexOf("]");
        const arr = a >= 0 && b > a ? JSON.parse(pbRaw.slice(a, b + 1)) : [];
        if (Array.isArray(arr)) {
          sonnetPlaybook = arr
            .filter(
              (pp: any) =>
                pp &&
                typeof pp.label === "string" &&
                typeof pp.detail === "string" &&
                pp.label.trim() &&
                pp.detail.trim()
            )
            .slice(0, 6)
            .map((pp: any) => ({
              label: String(pp.label),
              detail: String(pp.detail),
            }));
        }
      } finally {
        clearTimeout(pbTimer);
      }
    } catch (e) {
      console.error("Playbook (Sonnet) failed - keeping Haiku playbook:", e);
    }

    let playbook = sonnetPlaybook.length ? sonnetPlaybook : haikuPlaybook;

    const privateNotes = Array.isArray(plan.privateNotes)
      ? plan.privateNotes
          .filter((x: any) => typeof x === "string" && x.trim())
          .slice(0, 6)
      : [];

    let goals = Array.isArray(plan.goals)
      ? plan.goals.filter((x: any) => typeof x === "string" && x.trim()).slice(0, 8)
      : [];

    // GUARANTEE the rest of the plan, NOT just the focus. In step 2 the caller
    // passes a locked focus, which forces focusAreas to be non-empty - so the
    // old "focusAreas.length === 0" check below could NOT catch a structural
    // model that timed out and produced no questions/playbook/goals. That left
    // the panel showing only the focuses. Here we detect that empty-body case
    // and backfill the missing pieces from the deterministic fallback so step 2
    // always yields a full, usable plan.
    let degraded = false;
    // A timed-out structural call shows up as missing questions/goals (the
    // Sonnet playbook runs separately and may still have succeeded). Backfill
    // each missing piece independently so the panel is never left half-empty.
    const structuralFailed =
      openingQuestions.length === 0 && goals.length === 0;
    if (
      openingQuestions.length === 0 ||
      goals.length === 0 ||
      playbook.length === 0
    ) {
      const fb = buildFallback(brief, role, callType);
      if (openingQuestions.length === 0) openingQuestions = fb.openingQuestions;
      if (goals.length === 0) goals = fb.goals;
      if (playbook.length === 0) playbook = fb.playbook;
      if (!approach.goal && !approach.pathway.length) {
        approach.goal = fb.approach.goal;
        approach.premise = fb.approach.premise;
        approach.strategy = fb.approach.strategy;
        approach.pathway = fb.approach.pathway;
      }
      if (structuralFailed) degraded = true;
    }

    // GUARANTEE a usable plan. If the model gave us nothing parseable, fall
    // back to a deterministic, call-type-aware plan so the panel always
    // renders. degraded:true tells the client it's the generic safety net.
    if (focusAreas.length === 0) {
      const fb = buildFallback(brief, role, callType);
      return NextResponse.json(
        { ...fb, degraded: true },
        {
          headers: {
            "x-cost-usd": String(
              callCostUSD("haiku", planUsage) + callCostUSD("sonnet", pbUsage)
            ),
          },
        }
      );
    }

    return NextResponse.json(
      {
        callType,
        subjectName,
        approach,
        focusAreas,
        character,
        openingQuestions,
        playbook,
        privateNotes,
        goals,
        degraded,
      },
      {
        headers: {
          "x-cost-usd": String(
            callCostUSD("haiku", planUsage) + callCostUSD("sonnet", pbUsage)
          ),
        },
      }
    );
  } catch (err: any) {
    // Never 500 the page: return an empty-but-valid plan shape so the client
    // renders gracefully instead of throwing.
    console.error("Plan error:", err);
    // Even on an unexpected error, hand back a usable generic plan rather than
    // an empty one, so the page never dead-ends on "no plan".
    const fb = buildFallback(brief, role, "general");
    return NextResponse.json({ ...fb, degraded: true });
  }
}
