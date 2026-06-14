import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { gatherClientContext, gatherGlobalContext } from "@/lib/crm-context";

export const runtime = "nodejs";
export const maxDuration = 40;

// The CRM assistant. With a companyId it's grounded in that ONE client; without
// one it's GLOBAL - it knows every client + your whole pipeline, so you can just
// talk ("show Alan's to-do", "what's my to-do list", "which deal is closest").
// Always explains its reasoning. Drafts on request. Stores the thread (global
// thread = company_id null).
export async function POST(req: NextRequest) {
  try {
    const { companyId, message } = await req.json();
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const isGlobal = typeof companyId !== "string" || !companyId;

    const context = isGlobal
      ? await gatherGlobalContext()
      : await gatherClientContext(companyId);
    if (!context) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }

    // Recent thread for continuity. Global thread = rows with company_id null.
    let histQ = supabaseAdmin
      .from("assistant_messages")
      .select("role, content")
      .order("created_at", { ascending: false })
      .limit(12);
    histQ = isGlobal
      ? histQ.is("company_id", null)
      : histQ.eq("company_id", companyId);
    const { data: history } = await histQ;
    const priorTurns: { role: "user" | "assistant"; content: string }[] = (
      history || []
    )
      .reverse()
      .map((m: any) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as
          | "user"
          | "assistant",
        content: String(m.content),
      }));

    const scope = isGlobal
      ? `You are the user's overall CRM assistant. You know ALL their clients and their whole pipeline (below). They might ask about one client ("what do I do next with Alaine"), or across everyone ("what's my to-do list", "which deal is closest to closing"). When they name a client, match it to the closest one in the context even if the spelling is slightly off, and answer about them. When the question is across the board, pull from everyone.`
      : `You are the user's strategic CRM assistant for ONE client. You help them understand the relationship and move it forward.`;

    const system: any[] = [
      {
        type: "text",
        text: `${scope}

GROUND EVERYTHING in the context provided below. This is the hardest rule and it overrides being helpful.
- Never state a specific number, money amount, budget, deal value, date, deadline, percentage, stage, name or commitment unless it appears literally in the context. Do not estimate, assume, or infer a figure that isn't written there. If you catch yourself about to put a number in a sentence, check it is actually in the context first.
- If a piece of information is missing (no budget, no stage, no value, no next step recorded), say it is not recorded yet. Do NOT fill the gap with a plausible-sounding guess. "You haven't logged a budget for them" is a good answer. Inventing "a $200k budget" is a serious error.
- When a client's record is thin or empty, say so directly and tell the user what to capture first (link a call, set a stage, note the next step). Do not pad a near-empty record into multiple confident options or a detailed plan built on assumptions. A short honest answer beats a long invented one.
- If you are unsure whether something is in the context, treat it as not there and say so.

EXPLAIN THE WHY. Whenever you suggest a next step or a way to move a deal forward, work the reasoning into your sentences so the user learns the thinking, not just the instruction. Say what in the history makes it the right move. Do this in plain prose, not under a "Why:" label.

BE CONCRETE: real steps, who to contact, roughly when, what to say. When you suggest an order, explain it in a sentence.

HOW TO WRITE (this matters a lot - the user finds over-formatted answers robotic):
- Write the way a sharp colleague talks. Short paragraphs of plain sentences. Usually two to four short paragraphs is plenty.
- Do NOT use markdown formatting. No "#" or "##" headings. No "**bold**". No markdown tables.
- Avoid bullet-point and numbered lists unless the user explicitly asks for a list. Prefer flowing sentences. If you genuinely must list a few items, keep it to plain short lines with no bold.
- Never write words in all-caps for emphasis (no "TODAY", "NOW"). Don't shout.
- Never use em-dashes or semicolons. Use commas and full stops instead.
- Lead with the single most useful thing. Cut filler and preamble. Don't pad to sound thorough.

DRAFTS: when you write something the user would SEND or SHARE verbatim (an email, a text, a scope doc), put ONLY that sendable text between these exact marker lines:
---DRAFT---
<the sendable text only - for an email include a "Subject:" line then the body>
---END DRAFT---
Keep your commentary and reasoning OUTSIDE the markers. The text inside the markers can be plain and clean since it is what gets sent.

TONE: warm, sharp, brief. Plain English, like a smart colleague who knows the book of business well and respects your time.`,
      },
      {
        type: "text",
        text: `${isGlobal ? "PIPELINE CONTEXT" : "CLIENT CONTEXT"} (everything we know):\n\n${context}`,
        cache_control: { type: "ephemeral" },
      },
    ];

    const messages = [
      ...priorTurns,
      { role: "user" as const, content: message.trim() },
    ];

    let reply = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 34000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 1300,
            temperature: 0.4,
            system,
            messages,
          },
          { signal: controller.signal }
        );
        reply = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("Assistant model call failed:", e);
      return NextResponse.json(
        { error: "the assistant took too long - try again" },
        { status: 504 }
      );
    }

    if (!reply) reply = "Sorry, I couldn't form a reply just then. Try again?";

    await supabaseAdmin.from("assistant_messages").insert([
      {
        company_id: isGlobal ? null : companyId,
        role: "user",
        content: message.trim(),
      },
      {
        company_id: isGlobal ? null : companyId,
        role: "assistant",
        content: reply,
      },
    ]);

    return NextResponse.json({ reply });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "assistant failed" },
      { status: 500 }
    );
  }
}
