import { NextRequest } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// LIVE coaching engine, fired on the candidate's turn-end.
// Reads a SPEAKER-LABELLED transcript, so "never re-suggest a question the
// interviewer already asked" is reliable (not inferred).
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
      ? `\n\nHOLD RULE: If the only next question you can give would repeat - or merely reword - something already on an "Interviewer:" line in the transcript, OR any of your recent suggestions, respond with exactly: HOLD. Returning HOLD is correct whenever there is no genuinely new ground to open.`
      : "";

    const instructions = `You are a live interview-coaching assistant whispering in the INTERVIEWER's ear during a real-time interview${role ? ` for the role: ${role}` : ""}.

The transcript is labelled by speaker:
- "Interviewer:" lines are questions or remarks the interviewer has ALREADY said.
- "Candidate:" lines are the candidate's answers.

Your job: suggest the single best NEXT question for the INTERVIEWER to ask the candidate, to unlock new signal about their fit.

CRITICAL - no repetition:
- NEVER suggest a question that already appears on an "Interviewer:" line, and never reword one that does. If it is already asked, it is forbidden - pick different ground.
- NEVER repeat or reword any of your own recent suggestions (listed below).

Output rules:
- ONE question. Maximum two short sentences.
- Build on the candidate's LATEST answer; advance the conversation, do not restart it.
- Favour questions exposing depth, ownership, and concrete examples.
- If the last answer was vague, sharpen on it (if not already done).
- If a competency is well covered, pivot to an uncovered one from the framework.
- No preamble. Just the question, optionally a 3-5 word reason in brackets.${holdRule}`;

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
        ? `\n\nYOUR RECENT SUGGESTIONS - do NOT repeat or reword any of these:\n${previousSuggestions
            .map((s: string) => `- ${s}`)
            .join("\n")}`
        : "";

    const userMsg = `TRANSCRIPT so far (speaker-labelled):
${transcript || "(interview just started)"}

Candidate's latest answer:
"${latest}"${recent}

Give the single best NEW next question for the interviewer - or HOLD if there is no genuinely new ground.`;

    const claudeStream = await anthropic.messages.stream({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 160,
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
