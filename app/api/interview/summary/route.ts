import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { workspaceContextBlock, getLessonsBlock } from "@/lib/workspace";
import { estimateCost } from "@/lib/costs";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Auto-resolve the client for a call that arrived WITHOUT one (an ad-hoc call,
// or a calendar / Meet recording where no client was picked at the start). It is
// deliberately conservative: it only links on a confident, unambiguous match,
// otherwise the call simply stays unassigned for the one-tap picker on the
// dashboard. Order: (a) the client is named in the call's title or subject;
// (b) inherit from a prepped scheduled call near this time (the "lead contact in
// the prep section" - set the client once on a recurring call and every instance
// inherits it).
async function autoResolveCompany(opts: {
  sessionId?: string | null;
  candidate?: string | null;
  title?: string | null;
}): Promise<{ companyId: string; how: "name" | "prep" } | null> {
  try {
    const { data: comps } = await supabaseAdmin
      .from("companies")
      .select("id, name, profile");
    const companies = (comps || []) as any[];

    // (a) An exact client name / alias appears in the call title or subject.
    const hay = ` ${norm(`${opts.title || ""} ${opts.candidate || ""}`)} `;
    const nameHits = companies.filter((c) => {
      const aliases = Array.isArray((c.profile || {}).aliases)
        ? (c.profile as any).aliases
        : [];
      const names = [c.name, ...aliases]
        .map((n: any) => norm(String(n || "")))
        .filter((n: string) => n.length >= 3);
      return names.some((n: string) => hay.includes(` ${n} `));
    });
    if (nameHits.length === 1) {
      return { companyId: nameHits[0].id as string, how: "name" };
    }

    // (b) A prepped scheduled call near this call's time, with a client set.
    if (opts.sessionId) {
      const { data: sess } = await supabaseAdmin
        .from("interview_sessions")
        .select("created_at, started_at")
        .eq("session_id", opts.sessionId)
        .maybeSingle();
      const t =
        (sess as any)?.started_at || (sess as any)?.created_at || null;
      const callTimeMs = t ? new Date(t).getTime() : Date.now();
      const { data: up } = await supabaseAdmin
        .from("upcoming_calls")
        .select("company_id, scheduled_at")
        .not("company_id", "is", null);
      const near = (up || [])
        .map((u: any) => ({
          companyId: u.company_id as string,
          dt: Math.abs(new Date(u.scheduled_at).getTime() - callTimeMs),
        }))
        .filter((x) => Number.isFinite(x.dt) && x.dt <= 3 * 60 * 60 * 1000)
        .sort((a, b) => a.dt - b.dt);
      if (near.length) {
        const best = near[0];
        const conflict = near.some(
          (x) => x.companyId !== best.companyId && x.dt <= 90 * 60 * 1000
        );
        // Confident: nothing else within 90 min points elsewhere, and the best
        // is itself within 90 min (a real scheduled slot, not a vague nearby).
        if (!conflict && best.dt <= 90 * 60 * 1000) {
          return { companyId: best.companyId, how: "prep" };
        }
      }
    }
  } catch (e) {
    console.error("Auto-resolve company failed:", e);
  }
  return null;
}

// END-OF-CALL assessment. One call, on the pro model (Sonnet) for quality.
// Returns a structured JSON summary + scorecard + contributors + style profile.
export async function POST(req: NextRequest) {
  try {
    const { transcript, knowledgeContext, role, candidate, competencies, callType, sessionId, companyId, cost, source } =
      await req.json();

    if (!transcript || transcript.length < 30) {
      return NextResponse.json(
        { error: "Not enough conversation to summarise yet." },
        { status: 422 }
      );
    }

    const fixedComps =
      Array.isArray(competencies) && competencies.length
        ? competencies.filter((c: any) => typeof c === "string")
        : [];

    const cacheKey = createHash("sha256")
      .update(`${transcript}||${fixedComps.join(",")}||${role || ""}`)
      .digest("hex");

    // Durable cache: the same call (same transcript + competencies + role)
    // returns the stored result, so it never regenerates or drifts - even
    // after a refresh or days later.
    try {
      const { data: existing } = await supabaseAdmin
        .from("interview_summaries")
        .select("summary")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (existing?.summary) {
        return NextResponse.json({ summary: existing.summary, cached: true });
      }
    } catch (e) {
      console.error("Summary cache lookup failed:", e);
    }

    const compInstruction = fixedComps.length
      ? `Score EXACTLY these competencies, using these EXACT names, in this order - do not add, remove, merge, or rename any:\n${fixedComps
          .map((c: string) => `- ${c}`)
          .join("\n")}`
      : `Choose 3-6 role-relevant competencies to score.`;

    const typeName =
      callType && ["interview", "sales", "support"].includes(callType)
        ? callType
        : "";

    const [biz, lessons] = await Promise.all([
      workspaceContextBlock(),
      getLessonsBlock(["psychology", "strategy"]),
    ]);
    const system = `${biz}${lessons}You are an expert conversation assessor. You are given a speaker-labelled transcript of a ${typeName || "call"}${role ? ` (role / title in play: ${role})` : ""}, plus any supporting context (CV, notes, framework).

This is NOT necessarily an interview. ${
      typeName === "sales"
        ? "It is a sales / discovery call - read it for needs surfaced, qualification (budget / authority / timeline), objections, and how close it moved to a next step."
        : typeName === "support"
        ? "It is a support call - read it for problem clarity, progress toward resolution, and whether the issue was actually resolved."
        : typeName === "interview"
        ? "It is an interview - read it for evidence against the target competencies."
        : "Read it against the intent and target focus areas, whatever the conversation type."
    } The recommendation should be the overall read for THIS kind of call (for a sale: how ready/likely; for support: resolved or not; for an interview: the hire signal).

The transcript is labelled by speaker. One speaker is the HOST - this is the user you are writing FOR (the person being coached, labelled "You:", "Interviewer:", or by their own name). Always refer to the host as "you" in your output, or by their name. NEVER call the host "the interviewer" unless this is actually an interview (callType interview). There may be one or more OTHER participants, labelled by their real names (e.g. "Mark Darling:", "Alain:"). Refer to them by name. Only call someone a "candidate" if this is an interview - on a sales, support or general call they are the client or the other party, never a "candidate". If a subject/client name is provided in the inputs, use THAT exact spelling for that person throughout, even if the transcript spells it differently (auto-transcription mishears names) - the provided name is authoritative.

NO-SHOW / ONE-SIDED CALLS: check who actually spoke before writing anything. If only the host speaks and the other party never joined, or the transcript is just an opening audio or connection check with no real conversation, say that plainly (e.g. "Alain didn't join" or "the recording only captured the setup - no conversation took place"). Do NOT write as if the other party was present or said things they did not. In that case keep the whole summary short, set recommendation to "Incomplete", leave competency notes as "not explored", and put the obvious next action (reschedule, or message them to rebook) in myNextActions. Do not invent discussion that is not in the transcript.

Produce a fair, evidence-based post-call assessment. The assessment scores the CALL AS A WHOLE against its target competencies/intent - you are not producing a separate scorecard per person. Base EVERY point on what was actually said in the transcript - never invent. Where the transcript is thin or a competency wasn't explored, say so rather than guessing or padding scores.

Also extract a short STYLE PROFILE of the HOST (you), drawn ONLY from the host's own lines (labelled "You:", "Interviewer:", or the host's name - NOT the other participants): tone, how they phrase things, formality, warmth, and typical sentence length. This will later be used to match future suggestion wording to their natural style.

Output ONLY valid JSON (no markdown, no preamble) in exactly this shape:
{
  "callType": "one of: interview, sales, support, general - the best fit for THIS call",
  "title": "a short, specific title for this call, e.g. 'Avatar roadmap sync with Mark & Jay'",
  "recommendation": "the overall verdict for THIS kind of call (interview: Strong / Lean yes / Mixed / Lean no / Too early; sales: Hot / Warm / Cold / Dead; support: Resolved / Partly resolved / Unresolved; general: a one-word read)",
  "headline": "one sentence overall read",
  "overview": "2-4 sentences on how the call actually went - the gist, the mood, where it landed. Plain English, no jargon.",
  "competencies": [{"name": "competency", "score": 3, "note": "one short line of evidence"}],
  "strengths": ["short bullet", "..."],
  "concerns": ["short bullet", "..."],
  "contributors": [{"name": "participant name", "impact": "helped", "note": "the part they played and how it bore on the outcome"}],
  "questionReview": [{"question": "short version of a key question asked", "answered": "yes", "note": "if not fully answered, say briefly how it was dodged or deflected"}],
  "myNextActions": ["a concrete thing the HOST (you / the person being coached) needs to DO after this call - an email to send, a person to speak to, a decision to make, a thing to prepare", "..."],
  "theirNextActions": ["something another participant SAID they would do - name who, e.g. 'Mark: test the workable integration before go-live'", "..."],
  "suggestedNextActions": ["a smart next move YOU (the AI) recommend the host take - not necessarily said on the call, but the right strategic step given how it went", "..."],
  "notCovered": ["an area or question not yet explored", "..."],
  "styleProfile": "2-3 sentences on the host's speaking style and tone"
}

COMPETENCIES TO SCORE:
${compInstruction}

SCORING RUBRIC (apply consistently and literally, so the result is reproducible):
- 5 = strong, specific, compelling evidence in the transcript
- 4 = solid evidence, minor gaps
- 3 = adequate, some evidence
- 2 = weak or limited evidence
- 1 = little or no evidence, or a clear concern
- If a competency was NOT explored in the transcript, score it 1 or 2 and set its note to "not explored / insufficient evidence". NEVER inflate an unexplored competency.

Base every score strictly on transcript evidence against this rubric - not on general impression - so that running this again on the same transcript yields the same scores.

CONTRIBUTORS (who moved the call toward or away from its intent):
- The call is scored as a whole against the target competencies/intent above - you are NOT scoring individuals. This section simply credits who did what.
- List each distinct participant who spoke meaningfully, using their name exactly as labelled in the transcript. You MAY include the host (you) if your steering materially shaped the outcome.
- For each, "impact" is EXACTLY one of: "helped", "blocked", "mixed", "neutral" - did they move the conversation toward the target competencies/intent, derail or stall it, a mix of both, or neither.
- "note" is one short line: the part they played and how it bore on the scoring (e.g. "drove the problem-solving evidence with concrete detail on match scoring", "stalled ownership by never naming who owns the fix").
- Base strictly on the transcript. If there is only one other participant, list just them. 2-6 contributors.

QUESTION-BY-QUESTION REVIEW (questionReview):
- Go through the substantive questions you (the host) actually asked, in order (skip greetings/filler).
- For each: a short version of the question, whether it was actually answered - "answered" is exactly one of "yes", "partial", or "no" - and a one-line note.
- A confident, fluent reply that does not address what was asked is NOT a yes. If someone changed the subject, deflected, or answered a different question, mark "no" (or "partial") and say briefly how (e.g. "pivoted to career instead of the family question"). Surfacing these dodges clearly is the most important part of this review - do not be charmed by smooth delivery.

OVERVIEW:
- A short, honest narrative of how the call went - what it was about, how it flowed, where it ended up. This is the "how did it go" the host reads first. Plain English.

NEXT ACTIONS (this is the most useful part - be concrete and specific, grounded in the transcript):
- "myNextActions": what the HOST personally needs to do now. Real, actionable items - "Email Sarah the one-page concept by Friday", "Decide P1 vs P4 on the loading-spinner feedback", "Send Mark the pricing numbers". Pull these from open loops, things the host promised, and decisions left hanging. 2-6 items. If genuinely none, return an empty array.
- "theirNextActions": what each OTHER participant said they would do, so the host can track and chase it. Name the person. Only include things actually said. 0-6 items.
- "suggestedNextActions": YOUR recommendations - the smart next moves the host should consider that may NOT have been said on the call (a follow-up to send, a person to bring in, a risk to close off, a decision to force). Strategic and specific to this call. 2-5 items.

Rules: scores are 1-5 integers. 3-6 items in strengths/concerns/notCovered. "answered" must be "yes", "partial", or "no". "impact" must be "helped", "blocked", "mixed", or "neutral". Action items are short plain-English lines. Keep every bullet tight.`;

    const userMsg = `ROLE: ${role || "(not specified)"}
SUBJECT (the client / other party on the call - only a "candidate" if this is an interview): ${candidate || "(unknown)"}

COMPETENCIES TO SCORE (use these exact names if provided): ${
      fixedComps.length ? fixedComps.join(", ") : "(assessor's choice)"
    }

CV / FRAMEWORK:
${knowledgeContext || "(none provided)"}

TRANSCRIPT:
${transcript}

Return the JSON assessment now.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_PRO,
      max_tokens: 2600,
      temperature: 0,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const raw = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    let summary: any;
    try {
      summary = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      return NextResponse.json(
        { error: "Could not parse the summary. Try again." },
        { status: 500 }
      );
    }

    // Robust cost: the browser meter sometimes reports nothing (a Meet/bot call
    // where the in-app meter never ran, or the tab closed). Never let a real
    // call save as free - fall back to a cost derived from the call's actual
    // duration so the dashboard reflects reality.
    let finalCost: number | null = typeof cost === "number" ? cost : null;
    try {
      if (sessionId) {
        const { data: sess } = await supabaseAdmin
          .from("interview_sessions")
          .select("created_at, ended_at, source")
          .eq("session_id", sessionId)
          .maybeSingle();
        if (sess?.created_at) {
          const startMs = new Date(sess.created_at as string).getTime();
          const endMs = sess.ended_at
            ? new Date(sess.ended_at as string).getTime()
            : Date.now();
          // Cap at 4h so a tab left open can't inflate the figure.
          const durSec = Math.min(Math.max(0, (endMs - startMs) / 1000), 4 * 3600);
          if (durSec >= 30) {
            // Source is authoritative from the session row (set when the call
            // started, e.g. a bot sent to Meet); fall back to the client hint.
            const meet = ((sess as any).source || source) === "meet";
            const floor = estimateCost(durSec, 0, {
              transport: meet ? "recall" : "livekit",
              deepgramStreams: meet ? 0 : 2,
            }).totalGBP;
            finalCost = Math.max(finalCost || 0, floor);
          }
        }
      }
    } catch (e) {
      console.error("Duration-cost fallback failed:", e);
    }

    // The client for this call. Use the one passed from the start (the prep),
    // and if there isn't one, try to auto-resolve it so the call doesn't land
    // unassigned. Conservative - only links on a confident match.
    let resolvedCompanyId: string | null =
      typeof companyId === "string" && companyId ? companyId : null;
    if (!resolvedCompanyId) {
      const auto = await autoResolveCompany({
        sessionId,
        candidate,
        title: summary?.title,
      });
      if (auto) resolvedCompanyId = auto.companyId;
    }

    try {
      await supabaseAdmin.from("interview_summaries").insert({
        cache_key: cacheKey,
        session_id: sessionId || null,
        candidate: candidate || null,
        role: role || null,
        summary,
        // Stamp the linked company so the scorecard rolls up into that
        // company's call history (and feeds Phase 2 auto-attach).
        company_id: resolvedCompanyId,
        cost: finalCost,
      });
      // Keep the call-event row in step when we auto-linked one that started
      // without a client (matched by session_id), so both sides agree.
      if (resolvedCompanyId && sessionId) {
        await supabaseAdmin
          .from("interview_sessions")
          .update({ company_id: resolvedCompanyId })
          .eq("session_id", sessionId);
      }
    } catch (e) {
      console.error("Summary store failed:", e);
    }

    return NextResponse.json(
      { summary },
      {
        headers: {
          "x-usage": JSON.stringify(msg.usage || {}),
          "x-model": "sonnet",
        },
      }
    );
  } catch (err: any) {
    console.error("Summary route error:", err);
    return NextResponse.json(
      { error: err?.message || "Summary failed" },
      { status: 500 }
    );
  }
}
