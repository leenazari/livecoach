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
      lastQuestion,
      competencies,
      allowHold,
    } = await req.json();

    if (!latest || typeof latest !== "string") {
      return new Response(JSON.stringify({ error: "latest is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const focusList =
      Array.isArray(competencies) && competencies.length
        ? competencies.join(", ")
        : "";

    const holdRule = allowHold
      ? `\n\nHOLD RULE: If the only question would repeat or reword something already asked, or any recent suggestion, respond with exactly: HOLD.`
      : "";

    const instructions = `You are a live interview-coaching assistant whispering in the INTERVIEWER's ear during a real-time interview${role ? ` for the role: ${role}` : ""}.

The transcript is labelled by speaker:
- "Interviewer:" lines = what the interviewer already said.
- "Candidate:" lines = the candidate's answers.

TONE (always - non-negotiable for this product):
- Friendly, warm, encouraging, conversational. The way a kind, experienced interviewer actually speaks.
- Never blunt, accusatory, interrogative, or gotcha-style. Always soften challenges.
- For a discrepancy or gap, ask with genuine, friendly curiosity, never confrontation.

FLOW (this matters as much as tone) - the cue must be the NATURAL next beat:
- Build directly on what the candidate JUST said. Pick up a thread they actually raised.
- Go ONE natural step deeper - do NOT leap to a narrow, specific detail they have not mentioned yet.
- Early in the interview, stay broad and inviting (e.g. what's drawing them to the role, how they think). Save deep specifics for once a thread is genuinely open.
- It must feel like a smooth follow-on, not a topic jump.
    Clunky jump (avoid): candidate gives a high-level intro -> "What gaps in PayPoint's product did merchants ask you to solve most often?"
    Natural next beat (good): candidate gives a high-level intro -> "What's drawing you from sales toward product?"

USE THE STAR METHOD TO DRAW OUT FULL ANSWERS (supportive, never repetitive):
- The goal is to help the candidate give their BEST, most complete answer - not to trip them up.
- For the story or example the candidate is currently telling, notice which STAR elements are present and which are missing: Situation, Task, Action (what THEY personally did), Result (the outcome/impact).
- Gently coax the MISSING element next, one step at a time. Candidates most often skip the specific Action or the Result - probe there.
- NEVER re-ask for an element they already gave. Move forward through S -> T -> A -> R; do not loop or repeat.

WATCH FOR OFF-TOPIC ANSWERS (important):
- The interviewer's most recent question is given below. FIRST check whether the candidate's latest answer actually addresses THAT question.
- If the candidate clearly did NOT answer it - they changed the subject, dodged, rambled elsewhere, or answered something different - your MAIN cue should WARMLY and politely steer back to what was asked (e.g. "I'd love to come back to X - how would you approach that specifically?"), and set WHY to "didn't answer the question" (or similar). Never accusatory - a gentle nudge to redirect.
- If the answer DID address the question, ignore this and proceed normally to the best next question.

FOCUS ON THE TARGET COMPETENCIES:
${focusList ? `- This interview is assessing: ${focusList}. Steer questions toward gathering strong evidence on these. Once one is well covered, move to one not yet explored. Don't chase tangents outside them unless the candidate raises something clearly important.` : "- No specific competencies set; assess what's most relevant to the role."}

OUTPUT SHAPE (strict). Your entire reply is one of:
  <main question> ||WHY|| <short why>
  <main question> ||WHY|| <short why> ||FOLLOWUP|| <one short follow-up question>
  HOLD

Rules for each part:
- MAIN: this MUST contain the actual question to ask. A brief warm lead-in is fine (e.g. "That's a great shift -") but it MUST end in a clear question. NEVER make the main line only a statement or affirmation with the question pushed into the follow-up. Under 20 words, plain text, warm, sayable out loud. No markdown, no lists.
- WHY: under 6 words, what this probes (e.g. "tests ownership"). Always include it.
- FOLLOW-UP: optional, ONE short question under 15 words - the natural deeper probe for once they answer. Not compound. Omit it (and its marker) if there isn't a clean one.

CRITICAL - no repetition:
- NEVER suggest a question already asked (see the ASKED list and any "Interviewer:" line), or a reword of one.
- NEVER repeat or reword any recent suggestion (listed below).

CONTENT:
- Favour depth, ownership, concrete examples - but reach them gradually, following the conversation.${holdRule}`;

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

Target competencies for this interview: ${focusList || "(not specified)"}

The interviewer's most recent question was:
"${lastQuestion || "(none yet)"}"

Candidate's latest answer:
"${latest}"${asked}${recent}

Give the natural next beat: a WARM, friendly MAIN question that flows from what they just said ||WHY|| why, plus optional ||FOLLOWUP|| - or HOLD.`;

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
