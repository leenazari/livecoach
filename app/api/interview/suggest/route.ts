import { NextRequest } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// LIVE coaching engine. Output shape:
//   <main question> ||WHY|| <short why> ||FOLLOWUP|| <optional probe>
export async function POST(req: NextRequest) {
  try {
    const {
      knowledgeContext,
      transcript,
      latest,
      role,
      previousSuggestions,
      askedQuestions,
      allowHold,
    } = await req.json();

    if (!latest || typeof latest !== "string") {
      return new Response(JSON.stringify({ error: "latest is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const holdRule = allowHold
      ? `\n\nHOLD RULE: If the only question would repeat or reword something already asked, or any recent suggestion, respond with exactly: HOLD.`
      : "";

    const instructions = `You are a live interview-coaching assistant whispering in the INTERVIEWER's ear during a real-time interview${role ? ` for the role: ${role}` : ""}.

The transcript is labelled by speaker:
- "Interviewer:" lines = what the interviewer already said.
- "Candidate:" lines = the candidate's answers.

TONE - sound like a warm, experienced interviewer, NOT an interrogator:
- Phrase every cue the way a skilled, friendly interviewer would actually say it out loud - warm, curious, conversational.
- Never blunt, accusatory, or gotcha-style. Soften any challenge.
- For a discrepancy or gap, ask with genuine curiosity, never confrontation.
    Bad: "Your CV shows eight years, not six - which is correct?"
    Good: "I'd love to get the full picture of your time in EPOS - can you walk me through the journey?"
- Invite them to open up; avoid closed yes/no phrasing.

OUTPUT SHAPE (strict). Your entire reply is one of:
  <main question> ||WHY|| <short why>
  <main question> ||WHY|| <short why> ||FOLLOWUP|| <one short follow-up question>
  HOLD

Rules for each part:
- MAIN question: ONE thing, under 18 words, plain text, sayable out loud. No markdown, no lists, no "and", no meta-commentary.
- WHY: under 6 words, what this probes (e.g. "tests ownership"). Always include it.
- FOLLOW-UP: optional, ONE short question - the natural next probe. Omit it (and its marker) if there isn't a clean one.
- If something needs flagging (e.g. a CV/answer mismatch), make the MAIN line a SOFT, curious version of the question - never a blunt correction - and put the reason in WHY.

CRITICAL - no repetition:
- NEVER suggest a question already asked (see the ASKED list and any "Interviewer:" line), or a reword of one.
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

    const asked =
      Array.isArray(askedQuestions) && askedQuestions.length
        ? `\n\nQUESTIONS THE INTERVIEWER HAS ALREADY ASKED - never suggest these or a reword of them:\n${askedQuestions
            .map((q: string) => `- ${q}`)
            .join("\n")}`
        : "";

    const userMsg = `TRANSCRIPT (speaker-labelled):
${transcript || "(interview just started)"}

Candidate's latest answer:
"${latest}"${asked}${recent}

Reply in the strict output shape - a WARM, natural MAIN question ||WHY|| why, plus optional ||FOLLOWUP|| - or HOLD.`;

    const claudeStream = await anthropic.messages.stream({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 110,
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
