import { NextRequest } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// THE ADVISOR LANE (pro tier). One Sonnet call every ~30s that reads the
// discussion and offers the single best thing the host could SAY right now -
// a technical point, a concrete example, an accurate analogy, or a genuine
// quote/idea from a notable thinker - to advance or solidify the current idea.
// NOT a question (that's the fast Haiku lane). Returns HOLD when there's
// nothing substantive to add. Output reuses the ||WHY|| marker the client
// already parses: <statement> ||WHY|| <short tag>.
export async function POST(req: NextRequest) {
  try {
    const { knowledgeContext, transcript, role, subjectName, recentInsights } =
      await req.json();

    if (!transcript || typeof transcript !== "string") {
      return new Response(JSON.stringify({ error: "transcript required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const instructions = `You are a sharp intellectual advisor whispering to the HOST during a live, idea-driven conversation${
      role ? ` (context: ${role})` : ""
    }. Every ~30 seconds you read the discussion so far and offer ONE thing the host could SAY right now to advance or solidify the idea being worked out. NOT a question - questions are handled elsewhere.

Pick the single most useful of:
- a substantive TECHNICAL POINT - real, specific, correct understanding, no filler,
- a concrete EXAMPLE that makes the current idea click,
- an accurate ANALOGY that genuinely maps to the idea and clarifies it,
- a relevant QUOTE or framing from a notable thinker that crystallises the point.

ACCURACY IS NON-NEGOTIABLE:
- Use a quote ONLY if you are confident it is genuine and correctly attributed. If you are unsure of the wording or the author, DO NOT invent one - give the idea in your own words, or attribute loosely ("as Kahneman argued, ...") only when you are sure of the substance. NEVER fabricate a quote or an attribution.
- Analogies must actually map to the idea, not just sound clever. Technical claims must be correct. If you cannot be accurate, return HOLD.

PLAIN SPEECH - everyone in the room must understand it:
- Write the line so the host can say it ALOUD and anyone in the room gets it: no jargon, no acronyms without a plain gloss, no academic phrasing. Translate technical depth DOWN into clear, everyday language - a smart person explaining simply, not reading a textbook. Keep the substance; lose the jargon. If a technical term is unavoidable, fold a one-clause explanation into the line.

Distil the idea currently being worked out and give the host ONE crisp line (1-2 sentences) they can say out loud, in their own voice, ready to speak.

Output ONLY one of:
  <the thing to say> ||WHY|| <short tag, e.g. "analogy", "example", "technical", "Kahneman on judgement">
  HOLD

Return HOLD if there is genuinely nothing substantive to add (small talk, logistics, nothing intellectual in play). Don't force it - a good HOLD beats a weak line. Never repeat or reword anything in the RECENT INSIGHTS list.`;

    const system: any[] = [
      { type: "text", text: instructions },
      {
        type: "text",
        text: `KNOWLEDGE BASE (CV / docs / framework - for grounding):\n\n${
          knowledgeContext || "No knowledge base loaded."
        }`,
        cache_control: { type: "ephemeral" },
      },
    ];

    const recent =
      Array.isArray(recentInsights) && recentInsights.length
        ? `\n\nRECENT INSIGHTS - do NOT repeat or reword these:\n${recentInsights
            .map((x: string) => `- ${x}`)
            .join("\n")}`
        : "";

    const userMsg = `${
      subjectName
        ? `The main person is named "${subjectName}" - use THIS exact spelling if you name them, even if the transcript spells it differently.

`
        : ""
    }DISCUSSION SO FAR (speaker-labelled, most recent last):
${transcript}${recent}

Give the single best thing to say now to solidify the current idea - or HOLD.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_PRO,
      max_tokens: 220,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const text = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    return new Response(text || "HOLD", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Insight route error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Insight failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
