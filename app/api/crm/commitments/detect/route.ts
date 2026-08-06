import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { upsertTasks } from "@/lib/tasks";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/crm/commitments/detect { companyId?, clientName?, text, source? }
// Finds COMMITMENTS on both sides in a call recap/transcript or email thread,
// parses stated due dates, and prepares the user's own actions. The other
// party's commitments become wait/chase items, never ordinary user to-dos.
// Grounded: real promises only; never invents names, numbers or dates.
export async function POST(req: NextRequest) {
  try {
    const { companyId, clientName, text, source } = await req.json();
    const notes = typeof text === "string" ? text.trim() : "";
    if (notes.length < 12) return NextResponse.json({ created: [] });

    const today = new Date().toISOString().slice(0, 10);

    const system = `You read a call recap/transcript or an email thread and extract ONLY genuine COMMITMENTS made by either side: the user/host, and the other party.

For EACH commitment output an object:
{
 "text": short imperative reminder of the promise, under 12 words, starts with a verb,
 "ownerType": "me" if the user/host owns it, or "counterparty" if another participant owns it,
 "ownerName": "You" for the user, otherwise the participant's stated name or "They" if unknown,
 "actionType": "email" if the action is to write/send a message, otherwise "task",
 "due": an ISO date (YYYY-MM-DD) if a deadline was stated or clearly implied (resolve relative dates like "Friday", "next week" against TODAY), else null,
 "draft": for "email" -> {"subject": short subject, "body": a complete, ready-to-send short email in the user's own voice}; for "task" -> {"notes": concrete prep notes or a short checklist of what to get ready}
}

Rules:
- Capture commitments from BOTH sides, but only when the speaker genuinely promised or clearly agreed to do something. Ignore vague possibilities and generic suggested next actions.
- Never assign the other party's promise to the user, or the user's promise to the other party. Use the speaker labels and wording carefully.
- ONE item per real promise/outcome. Never split a single commitment into several items, and never create both a call and an email for the same person and purpose. Do NOT add hedging "check whether...", "decide whether...", "wait for..." or "follow up if no reply" items. If two promises are about the same person or outcome, merge them.
- Never invent names, companies, numbers, amounts, links or dates that are not supported by the text. If a detail is unknown, leave a clear placeholder like [their name] rather than guessing.
- Drafts must be warm, concise and sound like the user. NEVER use em dashes or semicolons anywhere in any drafted text - use full stops or commas.
- Keep email bodies short (a few sentences). Keep task notes tight.
- Return AT MOST 10 items. Output ONLY a JSON array, no prose, no markdown. Return [] if there are no genuine commitments.`;

    const user = `TODAY is ${today}.
${clientName ? `Other party / client: ${clientName}\n` : ""}SOURCE TEXT (recap, transcript, or email thread):
${notes.slice(0, 9000)}

Return the JSON array of both sides' genuine commitments now.`;

    let items: any[] = [];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 26000);
      try {
        const msg = await openai.messages.create(
          {
            model: OPENAI_MODEL_LIVE,
            max_tokens: 1900,
            temperature: 0.3,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("commitments", "live", (msg as any).usage);
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
      .slice(0, 10)
      .map((i) => {
        const ownerType =
          i.ownerType === "counterparty" ? "counterparty" : "me";
        const ownerName =
          typeof i.ownerName === "string" && i.ownerName.trim()
            ? i.ownerName.trim()
            : ownerType === "counterparty"
            ? "They"
            : "You";
        const actionType =
          ownerType === "me" && i.actionType === "email" ? "email" : "task";
        const draft = i.draft && typeof i.draft === "object" ? i.draft : {};
        const payload: Record<string, any> = {
          actionType,
          ownerType,
          ownerName,
        };
        if (actionType === "email") {
          payload.subject =
            typeof draft.subject === "string" ? draft.subject : "";
          payload.body = typeof draft.body === "string" ? draft.body : "";
        } else {
          payload.notes = typeof draft.notes === "string" ? draft.notes : "";
        }
        // ISO date only; ignore anything that isn't a plausible date.
        const due =
          typeof i.due === "string" && /^\d{4}-\d{2}-\d{2}/.test(i.due)
            ? i.due
            : null;
        return {
          text: String(i.text).trim(),
          kind:
            ownerType === "counterparty"
              ? "counterparty_commitment"
              : "commitment",
          linkKind: actionType === "email" ? "email" : "client",
          source: typeof source === "string" && source ? source : "commitment",
          payload,
          dueAt: due,
        };
      });

    const created = await upsertTasks(
      typeof companyId === "string" && companyId ? companyId : null,
      clean
    );
    return NextResponse.json({ created });
  } catch (err: any) {
    return NextResponse.json({ created: [], error: err?.message || "failed" });
  }
}
