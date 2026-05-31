import { NextRequest } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// LIVE coaching engine, fired on the candidate's turn-end.
// Returns a glanceable PRIMARY question, optionally followed by ONE deeper
// follow-up probe, separated by the marker ||FOLLOWUP|| so the client can
// render two tiers. Streams token-by-token.
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
      ? `\n\nHOLD RULE: If the only question would repeat or reword something already on an "Interviewer:" line, or any recent suggestion, respond with exactly: HOLD.`
      : "";

    const instructions = `You are a live interview-coaching assistant whispering in the INTERVIEWER's ear during a real-time interview${role ? ` for the role: ${role}` : ""}.

The transcript is labelled by speaker:
- "Interviewer:" lines = what the interviewer already said.
- "Candidate:" lines = the candidate's answers.

OUTPUT FORMAT (strict - this is read mid-conversation):
- Give a MAIN question. Then, if a natural deeper probe exists, append the marker ||FOLLOWUP|| and ONE short follow-up question.
- Your entire output is ONE of these two shapes:
    What metric told you onboarding was the problem? ||FOLLOWUP|| Did that show up in revenue?
  or just:
    What metric told you onboarding was the problem?
- MAIN question: ONE thing, under 15 words, plain text, sayable out loud. No markdown, no bold, no lists, no "and", no meta-commentary.
- FOLLOW-UP (optional): also ONE short question - the natural next probe if they answer the main one well. Omit it (and the marker) if there isn't a clean one.
- If something is genuinely wrong (e.g. answer contradicts the CV), make the MAIN line a terse flag, e.g.: Answer doesn't match the CV - ask which background is theirs.

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

Give the MAIN question (under 15 words) plus an optional ||FOLLOWUP|| probe - or HOLD.`;

    const claudeStream = await anthropic.messages.stream({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 80,
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
