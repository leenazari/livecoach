import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

// END-OF-CALL assessment. One call, on the pro model (Sonnet) for quality.
// Returns a structured JSON summary + scorecard + interviewer style profile.
export async function POST(req: NextRequest) {
  try {
    const { transcript, knowledgeContext, role, candidate, competencies, sessionId } =
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

    const system = `You are an expert interview assessor. You are given a speaker-labelled transcript of an interview${role ? ` for the role: ${role}` : ""}, plus the candidate's CV and any question framework.

Produce a fair, evidence-based post-interview assessment. Base EVERY point on what was actually said in the transcript - never invent. Where the transcript is thin or a competency wasn't explored, say so rather than guessing or padding scores.

Also extract a short STYLE PROFILE of the INTERVIEWER, drawn ONLY from the "Interviewer:" lines: their tone, how they phrase questions, formality, warmth, and typical sentence length. This will later be used to match future suggestion wording to their natural style.

Output ONLY valid JSON (no markdown, no preamble) in exactly this shape:
{
  "recommendation": "one of: Strong, Lean yes, Mixed, Lean no, Too early to tell",
  "headline": "one sentence overall read",
  "strengths": ["short bullet", "..."],
  "concerns": ["short bullet", "..."],
  "competencies": [{"name": "competency", "score": 3, "note": "one short line of evidence"}],
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

Rules: scores are 1-5 integers. 3-6 items in strengths/concerns/notCovered. Keep every bullet tight.`;

    const userMsg = `ROLE: ${role || "(not specified)"}
CANDIDATE: ${candidate || "(unknown)"}

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
      max_tokens: 1600,
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
