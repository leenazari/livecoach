import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// END-OF-CALL assessment. One call, on the pro model (Sonnet) for quality.
// Returns a structured JSON summary + scorecard + contributors + style profile.
export async function POST(req: NextRequest) {
  try {
    const { transcript, knowledgeContext, role, candidate, competencies, callType, sessionId } =
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

    const system = `You are an expert conversation assessor. You are given a speaker-labelled transcript of a ${typeName || "call"}${role ? ` (role / title in play: ${role})` : ""}, plus any supporting context (CV, notes, framework).

This is NOT necessarily an interview. ${
      typeName === "sales"
        ? "It is a sales / discovery call - read it for needs surfaced, qualification (budget / authority / timeline), objections, and how close it moved to a next step."
        : typeName === "support"
        ? "It is a support call - read it for problem clarity, progress toward resolution, and whether the issue was actually resolved."
        : typeName === "interview"
        ? "It is an interview - read it for evidence against the target competencies."
        : "Read it against the intent and target focus areas, whatever the conversation type."
    } The recommendation should be the overall read for THIS kind of call (for a sale: how ready/likely; for support: resolved or not; for an interview: the hire signal).

The transcript is labelled by speaker. One speaker is the INTERVIEWER (the person being coached - labelled "Interviewer:", "You:", or by their own name). There may be ONE OR MORE other participants, labelled "Candidate:" or by their real names (e.g. "Mark Darling:", "Jaykishan:"). Treat each named person as a distinct individual.

Produce a fair, evidence-based post-call assessment. The assessment scores the CALL AS A WHOLE against its target competencies/intent - you are not producing a separate scorecard per person. Base EVERY point on what was actually said in the transcript - never invent. Where the transcript is thin or a competency wasn't explored, say so rather than guessing or padding scores.

Also extract a short STYLE PROFILE of the INTERVIEWER, drawn ONLY from the interviewer's own lines (the lines labelled "Interviewer:", "You:", or the interviewer's name - NOT the other participants): their tone, how they phrase questions, formality, warmth, and typical sentence length. This will later be used to match future suggestion wording to their natural style.

Output ONLY valid JSON (no markdown, no preamble) in exactly this shape:
{
  "recommendation": "one of: Strong, Lean yes, Mixed, Lean no, Too early to tell",
  "headline": "one sentence overall read",
  "strengths": ["short bullet", "..."],
  "concerns": ["short bullet", "..."],
  "competencies": [{"name": "competency", "score": 3, "note": "one short line of evidence"}],
  "contributors": [{"name": "participant name", "impact": "helped", "note": "the part they played and how it bore on the scoring"}],
  "questionReview": [{"question": "short version of what the interviewer asked", "answered": "yes", "note": "if not fully answered, say briefly how they dodged or deflected"}],
  "notCovered": ["an area or question not yet explored", "..."],
  "styleProfile": "2-3 sentences on the interviewer's speaking style and tone"
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
- List each distinct participant who spoke meaningfully, using their name exactly as labelled in the transcript. You MAY include the interviewer (You) if their steering materially shaped the outcome.
- For each, "impact" is EXACTLY one of: "helped", "blocked", "mixed", "neutral" - did they move the conversation toward the target competencies/intent, derail or stall it, a mix of both, or neither.
- "note" is one short line: the part they played and how it bore on the scoring (e.g. "drove the problem-solving evidence with concrete detail on match scoring", "stalled ownership by never naming who owns the fix").
- Base strictly on the transcript. If there is only one other participant, list just them. 2-6 contributors.

QUESTION-BY-QUESTION REVIEW (questionReview):
- Go through the substantive questions the interviewer actually asked, in order (skip greetings/filler).
- For each: a short version of the question, whether it was actually answered - "answered" is exactly one of "yes", "partial", or "no" - and a one-line note.
- A confident, fluent reply that does not address what was asked is NOT a yes. If someone changed the subject, deflected, or answered a different question, mark "no" (or "partial") and say briefly how (e.g. "pivoted to career instead of the family question"). Surfacing these dodges clearly is the most important part of this review - do not be charmed by smooth delivery.

Rules: scores are 1-5 integers. 3-6 items in strengths/concerns/notCovered. "answered" must be "yes", "partial", or "no". "impact" must be "helped", "blocked", "mixed", or "neutral". Keep every bullet tight.`;

    const userMsg = `ROLE: ${role || "(not specified)"}
CANDIDATE / SUBJECT: ${candidate || "(unknown)"}

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
      max_tokens: 2000,
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

    try {
      await supabaseAdmin.from("interview_summaries").insert({
        cache_key: cacheKey,
        session_id: sessionId || null,
        candidate: candidate || null,
        role: role || null,
        summary,
      });
    } catch (e) {
      console.error("Summary store failed:", e);
    }

    return NextResponse.json({ summary });
  } catch (err: any) {
    console.error("Summary route error:", err);
    return NextResponse.json(
      { error: err?.message || "Summary failed" },
      { status: 500 }
    );
  }
}
