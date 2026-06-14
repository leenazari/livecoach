import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { gatherClientContext } from "@/lib/crm-context";

export const runtime = "nodejs";
export const maxDuration = 40;

// The per-client AI assistant. POST a message; it loads the full client context
// + the recent thread, answers as a strategic relationship advisor, stores both
// turns, and returns the reply. Always explains its reasoning so the user learns
// the thinking. Drafts emails / scope docs / next-call plans on request.
export async function POST(req: NextRequest) {
  try {
    const { companyId, message } = await req.json();
    if (typeof companyId !== "string" || !companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const context = await gatherClientContext(companyId);
    if (!context) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }

    // Recent thread for continuity (so "yes, draft it" works).
    const { data: history } = await supabaseAdmin
      .from("assistant_messages")
      .select("role, content")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(12);
    const priorTurns = (history || [])
      .reverse()
      .map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content),
      }));

    const system: any[] = [
      {
        type: "text",
        text: `You are the user's strategic CRM assistant for ONE client. You help them understand the relationship and move it forward - answering questions, suggesting next moves, and drafting things (emails, scope documents, the playbook for the next call) on request.

GROUND EVERYTHING in the client context provided below. Never invent facts, names, numbers, dates or commitments that aren't supported by it. If you don't know something, say so plainly and say what you'd need.

ALWAYS EXPLAIN THE WHY. This is non-negotiable: whenever you suggest a next step, a task, or a way to close the deal, give the REASONING behind it in a short, plain "why" - what in the history makes this the right move. The user wants to learn the thinking, not just follow instructions. Never hand over a bare to-do.

BE CONCRETE: real steps, who to contact, roughly when, what to say. When you propose a sequence, order it and explain the order.

OFFER THEN DRAFT: when a next step involves a message or document, briefly offer to draft it, and if the user says yes (or asks directly), write it in full. For an email, give a clear "Subject:" line then the body. For a scope document or next-call playbook, lay it out clearly with short headings or bullets.

TONE: warm, sharp, concise. Plain English. Talk like a smart colleague who knows this client well.`,
      },
      {
        type: "text",
        text: `CLIENT CONTEXT (everything we know):\n\n${context}`,
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

    // Persist both turns (fire-and-forget on the store itself is fine).
    await supabaseAdmin.from("assistant_messages").insert([
      { company_id: companyId, role: "user", content: message.trim() },
      { company_id: companyId, role: "assistant", content: reply },
    ]);

    return NextResponse.json({ reply });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "assistant failed" },
      { status: 500 }
    );
  }
}
