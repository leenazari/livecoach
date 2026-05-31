import { NextRequest } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// LIVE coaching engine (fires every ~5s from the client).
//
// Cost design:
//  - Knowledge (CV + framework) is loaded ONCE by /context and passed in here
//    each call, placed in a system block with cache_control. After the first
//    call it's a cheap cache READ (~0.1x), not a full re-send.
//  - Runs on Haiku 4.5 (the cheap live tier). Sonnet/Opus = pro track later.
//  - Output capped at 160 tokens. Transcript is a bounded recent window.
export async function POST(req: NextRequest) {
  try {
    const { knowledgeContext, recentWindow, latest, role } = await req.json();

    if (!latest || typeof latest !== "string") {
      return new Response(JSON.stringify({ error: "latest is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const instructions = `You are a live interview-coaching assistant whispering in the interviewer's ear during a real-time interview${role ? ` for the role: ${role}` : ""}.

Your ONLY job: based on the conversation so far and the candidate's latest words, give the single best next question or probe to ask — to unlock signal about this person's fit.

Rules:
- ONE suggestion. Maximum two short sentences.
- Build on what the candidate just said; don't reset the topic.
- Favour questions exposing depth, ownership, and concrete examples.
- If the last answer was vague, suggest a sharpening follow-up.
- If a competency is exhausted, pivot to an uncovered one from the framework.
- No preamble. Just the question, optionally a 3-5 word reason in brackets.
- If nothing new has been said, refine or hold the previous line of questioning.`;

    // System as content blocks. The knowledge block is cached so repeated
    // 5s calls don't pay full input price for it every time.
    const system: any[] = [
      { type: "text", text: instructions },
      {
        type: "text",
        text: `KNOWLEDGE BASE (candidate CV / previous summary / question framework):\n\n${knowledgeContext || "No knowledge base loaded."}`,
        cache_control: { type: "ephemeral" },
      },
    ];

    const userMsg = `Conversation so far (recent):
${recentWindow || "(interview just started)"}

Candidate's latest words:
"${latest}"

What should the interviewer ask next?`;

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
