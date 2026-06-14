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

GROUND EVERYTHING in the context provided below. Never invent facts, names, numbers, dates or commitments that aren't supported by it. If you don't know something, say so plainly.

ALWAYS EXPLAIN THE WHY. Non-negotiable: whenever you suggest a next step, a task, or a way to close a deal, give the REASONING in a short, plain "why" - what in the history makes this the right move. The user wants to learn the thinking, not just follow instructions.

BE CONCRETE: real steps, who to contact, roughly when, what to say. When you propose a sequence, order it and explain the order.

DRAFT FORMATTING: when you write something the user would SEND or SHARE verbatim (an email, a text, a scope doc), put ONLY that sendable text between these exact marker lines:
---DRAFT---
<the sendable text only - for an email include a "Subject:" line then the body>
---END DRAFT---
Keep your commentary and "why" OUTSIDE the markers.

TONE: warm, sharp, concise. Plain English, like a smart colleague who knows the book of business well.`,
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
