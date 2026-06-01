import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

// END-OF-CALL assessment. One call, on the pro model (Sonnet) for quality.
// Returns a structured JSON summary + scorecard + interviewer style profile.
export async function POST(req: NextRequest) {
  try {
    const { transcript, knowledgeContext, role, candidate } = await req.json();

    if (!transcript || transcript.length < 30) {
      return NextResponse.json(
        { error: "Not enough conversation to summarise yet." },
        { status: 422 }
      );
    }

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

Rules: scores are 1-5 integers. 3-6 items per list. 3-6 role-relevant competencies. Keep every bullet tight.`;

    const userMsg = `ROLE: ${role || "(not specified)"}
CANDIDATE: ${candidate || "(unknown)"}

CV / FRAMEWORK:
${knowledgeContext || "(none provided)"}

TRANSCRIPT:
${transcript}

Return the JSON assessment now.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_PRO,
      max_tokens: 1600,
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

    return NextResponse.json({ summary });
  } catch (err: any) {
    console.error("Summary route error:", err);
    return NextResponse.json(
      { error: err?.message || "Summary failed" },
      { status: 500 }
    );
  }
}
