import { NextRequest } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// LIVE coaching engine. Knowledge is cached; only the new transcript varies.
// Hardened against two failure modes seen in testing:
//   1. Re-suggesting a question the interviewer ALREADY asked (it's in the transcript).
//   2. Rewording a suggestion it already gave moments ago.
// Both are handled in the prompt because semantic duplicates can't be caught
// reliably by string matching on the client.
export async function POST(req: NextRequest) {
  try {
    const {
      knowledgeContext,
      recentWindow,
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
      ? `\n\nHOLD RULE: If the only next question you can think of would repeat — or merely reword — something already asked in the transcript OR something in your recent suggestions, respond with exactly: HOLD\nReturning HOLD is correct and expected whenever the conversation has not opened genuinely new ground. Do not force a suggestion.`
      : "";

    const instructions = `You are a live interview-coaching assistant whispering in the interviewer's ear during a real-time interview${role ? ` for the role: ${role}` : ""}.

Your job: suggest the single best NEXT question for the interviewer to ask — to unlock new signal about this candidate's fit.

CRITICAL — avoid repetition:
- The transcript contains questions the interviewer has ALREADY asked. NEVER suggest a question that has already been asked, and never reword one that was already asked. If you see your suggested question (or a paraphrase of it) already in the transcript, it is forbidden — pick different ground.
- NEVER repeat or reword any of your own recent suggestions (listed below).
- "Reword" means same underlying ask with different words. e.g. "walk me through a time you spotted a gap…" and "describe a specific moment you identified an opportunity…" are the SAME question — not allowed.

Output rules:
- ONE suggestion. Maximum two short sentences.
- Build on what the candidate just SAID; advance the conversation, don't restart it.
- Favour questions exposing depth, ownership, and concrete examples.
- If the last answer was vague, sharpen on that — but only if you haven't already.
- If a competency is well-covered, pivot to an uncovered one from the framework.
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
        ? `\n\nYOUR RECENT SUGGESTIONS — do NOT repeat or reword any of these:\n${previousSuggestions
            .map((s: string) => `- ${s}`)
            .join("\n")}`
        : "";

    const userMsg = `TRANSCRIPT so far (this includes questions the interviewer has ALREADY asked — do not suggest any of them again):
${recentWindow || "(interview just started)"}

Candidate's latest words:
"${latest}"${recent}

Give the single best NEW next question — or HOLD if there isn't genuinely new ground to cover.`;

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
