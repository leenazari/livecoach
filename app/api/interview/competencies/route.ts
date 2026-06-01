import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// Suggests the competency keywords worth assessing for THIS role + candidate,
// so the interviewer can pick a focused plan before the call.
export async function POST(req: NextRequest) {
  try {
    const { role, knowledgeContext } = await req.json();

    const system = `You are an expert interviewer. Given a role and the candidate's CV / question framework, propose the 8-10 most important COMPETENCIES to assess for THIS role - the qualities that genuinely predict success in it.

Use short, keyword-style labels (1-4 words each), e.g. "Consultative selling", "Resilience", "Pipeline discipline", "Commercial impact". Make them specific to this role, not generic filler.

Output ONLY a JSON array of short strings. No markdown, no preamble.
Example: ["Consultative selling", "Resilience", "Pipeline discipline"]`;

    const userMsg = `ROLE: ${role || "(not specified)"}

CV / FRAMEWORK:
${knowledgeContext || "(none provided)"}

Return the JSON array of competency keywords now.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const raw = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    let competencies: string[] = [];
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      competencies = Array.isArray(parsed)
        ? parsed.filter((x) => typeof x === "string" && x.trim()).slice(0, 12)
        : [];
    } catch {
      competencies = [];
    }

    return NextResponse.json({ competencies });
  } catch (err: any) {
    console.error("Competencies error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate competencies" },
      { status: 500 }
    );
  }
}
