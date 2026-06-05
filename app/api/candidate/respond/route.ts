import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

type Mode = "cooperative" | "rambling" | "evasive";

// The behaviour dial - lets Lee deliberately exercise the live features:
// evasive -> triggers the rust REDIRECT flag; thin/cooperative -> STAR coaxing.
const MODE_GUIDE: Record<Mode, string> = {
  cooperative:
    "Answer the question directly and helpfully. When it calls for an example, give a concrete one - what the situation was, what you did, and the outcome. Stay focused: 2-3 spoken sentences.",
  rambling:
    "Answer, but wander - add tangents and extra detail the interviewer didn't ask for, and take a while to get to the point. 4-6 spoken sentences.",
  evasive:
    "Do NOT really answer the question. Deflect, stay vague, or drift onto a different topic you'd rather talk about. Avoid specifics. 1-3 spoken sentences. (You are testing whether the interviewer notices you dodged.)",
};

export async function POST(req: NextRequest) {
  try {
    const { question, history, cvContext, mode } = await req.json();
    const m: Mode = (
      ["cooperative", "rambling", "evasive"].includes(mode) ? mode : "cooperative"
    ) as Mode;

    if (!question || !String(question).trim()) {
      return NextResponse.json({ answer: "" });
    }

    const persona =
      cvContext && String(cvContext).trim()
        ? `You are the candidate whose CV is below. Stay completely in character as this person, drawing on their real experience.\n\n--- YOUR CV ---\n${cvContext}\n--- END CV ---`
        : "You are a candidate interviewing for a role. Invent a plausible, consistent background and stick to it.";

    const system = `${persona}

You are in a live job interview, speaking out loud. Reply in FIRST PERSON as the candidate. Use natural spoken English - no markdown, no lists, no stage directions, no surrounding quotation marks. Never break character or mention being an AI.

BEHAVIOUR FOR THIS ANSWER: ${MODE_GUIDE[m]}

Keep it realistic and short enough to say out loud in one breath or two.`;

    const convo =
      history && String(history).trim()
        ? `Conversation so far:\n${history}\n\n`
        : "";

    const userMsg = `${convo}The interviewer just asked:\n"${question}"\n\nGive your spoken reply as the candidate.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 220,
      temperature: 0.7,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const answer = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error("Candidate respond error:", err);
    return NextResponse.json(
      { error: err?.message || "Respond failed" },
      { status: 500 }
    );
  }
}
