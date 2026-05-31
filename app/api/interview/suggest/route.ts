import { NextRequest } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// LIVE coaching engine, fired on the candidate's turn-end.
// Output is a GLANCEABLE one-line whisper - read mid-conversation.
export async function POST(req: NextRequest) {
  try {
    const {
      knowledgeContext,
      transcript,
      latest,
      role,
      previousSuggestions,
      allowHold,
    } = await req.json();

    if (!latest || typeof latest !== "string") {
      return new Response(JSON.stringify({ error: "latest is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const holdRule = allowHold
      ? `\n\nHOLD RULE: If the only next question would repeat or reword something already on an "Interviewer:" line, or any recent suggestion, respond with exactly: HOLD.`
      : "";

    const instructions = `You are a live interview-coaching assistant whispering in the INTERVIEWER's ear during a real-time interview${role ? ` for the role: ${role}` : ""}.

The transcript is labelled by speaker:
- "Interviewer:" lines = what the interviewer already said.
- "Candidate:" lines = the candidate's answers.

OUTPUT FORMAT - this is a glanceable whisper the interviewer reads WHILE talking:
- ONE short line only. Ideally under 15 words. Readable in a single glance and sayable out loud.
- PLAIN TEXT ONLY. No markdown, no bold, no asterisks, no headings, no line breaks.
- NO meta-commentary. Never say "I need to flag", "this is a coaching suggestion", "the interview cannot continue", or describe what you are doing. Just give the cue itself.
- Ask ONE thing. No compound questions, no lists of options, no "and".
- You may end with a 2-4 word reason in square brackets. Nothing more.

IF SOMETHING IS GENUINELY WRONG (e.g. the answer contradicts the CV):
- Flag it, but in ONE terse line. Example: "Answer doesn't match the CV - ask which background is theirs. [mismatch]"
- Never an essay. One line, same as any other cue.

CRITICAL - no repetition:
- NEVER suggest a question already on an "Interviewer:" line, or a reword of one.
- NEVER repeat or reword any recent suggestion (listed below).

CONTENT:
- Build on the candidate's LATEST answer. Favour depth, ownership, concrete examples.
- If the answer was vague, sharpen on it. If a competency is well covered, pivot to an uncovered one.${holdRule}`;

    const system: any[] = [
      { type: "text", text: instructions },
      {
        type: "text",
        text: `KNOWLEDGE BASE (candidate CV / previous summary / question framework):\n\n${knowledgeContext || "No knowledge base loaded."}`,
        cache_control: { type: "ephemeral" },
      },
    ];

    const recent =
      Array.isArray(previousSuggestions) && previousSuggestions.length
        ? `\n\nRECENT SUGGESTIONS - do NOT repeat or reword:\n${previousSuggestions
            .map((s: string) => `- ${s}`)
            .join("\n")}`
        : "";

    const userMsg = `TRANSCRIPT (speaker-labelled):
${transcript || "(interview just started)"}

Candidate's latest answer:
"${latest}"${recent}

Give ONE short, glanceable, spoken question (under 15 words) - or HOLD.`;

    const claudeStream = await anthropic.messages.stream({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 60,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of claudeStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (e) {
          console.error("Stream error:", e);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err: any) {
    console.error("Suggest route error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Suggestion failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
