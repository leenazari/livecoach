import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// Generates the opening interview questions BEFORE anyone speaks,
// purely from the candidate's CV + the job title. No transcript needed.
// Returns a JSON array of question strings.
export async function POST(req: NextRequest) {
  try {
    const { knowledgeContext, role } = await req.json();

    if (!knowledgeContext || knowledgeContext.length < 20) {
      return NextResponse.json(
        { error: "Upload a CV (and set a role) first." },
        { status: 422 }
      );
    }

    const system = `You are an expert interviewer preparing to interview a candidate${role ? ` for the role: ${role}` : ""}.

Using ONLY the candidate's CV and any question framework provided, write the 3 best OPENING questions to start the interview — the ones that quickly probe the most relevant, role-critical parts of their background.

Rules:
- Tailor each question to something specific in THIS candidate's CV against the role.
- Favour questions that open up depth and concrete examples, not yes/no.
- Each question one or two sentences max.
- Output ONLY a JSON array of 3 strings. No markdown, no preamble, no keys.
Example format: ["question one", "question two", "question three"]`;

    const userMsg = `Role: ${role || "(not specified)"}

KNOWLEDGE (candidate CV / framework):
${knowledgeContext}

Return the JSON array of 3 opening questions now.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const raw = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    // Parse the JSON array; fall back to splitting lines if needed.
    let questions: string[] = [];
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      questions = JSON.parse(cleaned);
    } catch {
      questions = raw
        .split("\n")
        .map((l) => l.replace(/^[\s\-\d.)"]+|"$/g, "").trim())
        .filter(Boolean)
        .slice(0, 3);
    }

    return NextResponse.json({ questions });
  } catch (err: any) {
    console.error("Opening questions error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate opening questions" },
      { status: 500 }
    );
  }
}
