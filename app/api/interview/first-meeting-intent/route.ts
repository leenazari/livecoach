import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";
import { workspaceContextBlock } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

// FIRST-MEETING INTENT. A brand-new client has no call history, so the normal
// carry-over / prep-intent (which read past scorecards) have nothing to work
// with. But there IS a company (the email domain), often an email thread, and
// what the host sells (the brain). This drafts a concise first-person intent for
// a first meeting from exactly those, so the screen is never blank and the plan
// has something to build a focus from. Cheap + fast (Haiku). Writes nothing.

const tidy = (s: string) =>
  String(s || "")
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const company = typeof body.company === "string" ? body.company.trim() : "";
    const person = typeof body.person === "string" ? body.person.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const background =
      typeof body.background === "string" ? body.background.trim() : "";
    const emailContext =
      typeof body.emailContext === "string" ? body.emailContext.trim() : "";

    // Need at least a company or a person to draft anything sensible.
    if (!company && !person && !background) {
      return NextResponse.json(
        { error: "not enough to draft an intent from yet" },
        { status: 422 }
      );
    }

    const biz = await workspaceContextBlock();
    const system = `${biz}You are drafting the host's INTENT for a FIRST meeting with a new client. There is no call history, so build it from what is given below: who the host sells to and what they sell (above), the client company and person, the company research, and the email thread if there is one.

Write the intent in the host's own first-person voice, 2 to 4 sentences. Cover: who this client is and what they likely need (grounded in the research), what the host wants to understand on this call (their situation, the fit, whether they are a real buyer), and the next step worth aiming for. Make it specific to THIS company, not generic.

Rules:
- Ground everything only in what is given. Never invent facts about the client. If the research is thin, keep the intent about what to find out, and say plainly that this is a first meeting to understand them.
- Plain English, first person ("I want to ...", "I need to understand ..."). No markdown, no headings, no bold. No em-dashes or semicolons, use commas and full stops.
- Output ONLY the intent text, nothing else.`;

    const userMsg = `CLIENT COMPANY: ${company || "(unknown)"}
PERSON ON THE CALL: ${person || "(unknown)"}${role ? `, ${role}` : ""}
MEETING TITLE: ${title || "(none)"}

COMPANY RESEARCH (from their website / the open web, may be empty):
${background || "(none yet)"}

EMAIL THREAD SO FAR (may be empty):
${emailContext || "(none)"}

Draft the first-meeting intent now.`;

    let intent = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_LIVE,
            max_tokens: 400,
            temperature: 0.4,
            system,
            messages: [{ role: "user", content: userMsg }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("first-meeting-intent", "haiku", (msg as any).usage);
        intent = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("first-meeting-intent failed:", e);
      return NextResponse.json(
        { error: "could not draft an intent, try again" },
        { status: 504 }
      );
    }

    if (!intent) {
      return NextResponse.json(
        { error: "could not draft an intent" },
        { status: 502 }
      );
    }
    return NextResponse.json({ intent: tidy(intent) });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to draft an intent" },
      { status: 500 }
    );
  }
}
