import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { upsertTasks, actionToLinkKind } from "@/lib/tasks";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/crm/extract-tasks { companyId?, text, clientName?, source? }
// Turns spoken or typed notes (a post-call voice debrief, a quick ramble) into
// concrete to-dos with an action attached, and saves them against the client.
// Grounded: it only captures real next steps and never invents names, numbers
// or dates. Best-effort - always returns 200 so the UI never blocks on it.
export async function POST(req: NextRequest) {
  try {
    const { companyId, text, clientName, source } = await req.json();
    const notes = typeof text === "string" ? text.trim() : "";
    if (notes.length < 4) return NextResponse.json({ created: [] });

    const system = `You turn the user's spoken or typed notes into concrete CRM to-dos.
Output ONLY a JSON array. Each item is {"text": a short imperative to-do, "action": one of "email", "call", "task"}.
Rules:
- Capture only real next steps the user stated or clearly intends. If the notes ramble or contain nothing actionable, return [].
- Use "email" for anything to write or send, "call" to prep or schedule a call, "task" for anything else.
- Keep each "text" short and specific, under 12 words, starting with a verb.
- Never invent names, companies, numbers, amounts or dates that are not in the notes.
- Return at most 8 items. No prose, no markdown, only the JSON array.`;

    const user = `${clientName ? `Client: ${clientName}\n` : ""}Notes:\n${notes.slice(
      0,
      6000
    )}`;

    let items: { text?: string; action?: string }[] = [];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 24000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_LIVE,
            max_tokens: 600,
            temperature: 0.2,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("extract-tasks", "haiku", (msg as any).usage);
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
        const a = raw.indexOf("[");
        const b = raw.lastIndexOf("]");
        const parsed = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : [];
        if (Array.isArray(parsed)) items = parsed;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return NextResponse.json({ created: [] });
    }

    const clean = items
      .filter((i) => i && typeof i.text === "string" && i.text.trim())
      .slice(0, 8)
      .map((i) => ({
        text: String(i.text).trim(),
        linkKind: actionToLinkKind(i.action),
        source: typeof source === "string" && source ? source : "debrief",
      }));

    const created = await upsertTasks(
      typeof companyId === "string" && companyId ? companyId : null,
      clean
    );
    return NextResponse.json({ created });
  } catch (err: any) {
    return NextResponse.json({ created: [], error: err?.message || "failed" });
  }
}
