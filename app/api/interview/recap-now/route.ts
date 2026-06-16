import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 20;

// Quick MID-CALL wrap-up. Before ending, the host taps Summarise and gets a fast
// bullet card to read out loud: who is doing what, promises made, key points, and
// important questions raised but not yet answered. Fast + cheap (Haiku, low
// tokens) so it loads in a couple of seconds. NOT the full end summary.
export async function POST(req: NextRequest) {
  try {
    const { transcript, subjectName } = await req.json();
    const t = typeof transcript === "string" ? transcript.trim() : "";
    if (t.length < 30) {
      return NextResponse.json({
        actions: [],
        promises: [],
        keyPoints: [],
        openQuestions: [],
      });
    }

    const system = `You are wrapping up a LIVE call so the host can confirm next steps OUT LOUD before ending it. From the transcript SO FAR, pull ONLY what was actually said:
- actions: who agreed to do what next. Each {"who": the person's name (or "You" for the host), "what": the action in a few words}. Always name the owner.
- promises: explicit promises or commitments anyone made.
- keyPoints: the few most important statements or decisions (max 5).
- openQuestions: important questions that were RAISED but NOT clearly answered yet, so the host can flag them before ending.
Ground STRICTLY in the transcript. Never invent names, numbers or actions. Keep every item short and punchy (a few words). If a section has nothing, return an empty array for it.
Output ONLY JSON: {"actions":[{"who":"","what":""}],"promises":[],"keyPoints":[],"openQuestions":[]}`;

    const user = `${subjectName ? `Main other party: ${subjectName}\n` : ""}TRANSCRIPT SO FAR (most recent last):
${t.slice(-9000)}

Return the JSON wrap-up now.`;

    let parsed: any = {};
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_LIVE,
            max_tokens: 700,
            temperature: 0.2,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("recap-now", "haiku", (msg as any).usage);
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        parsed = s >= 0 && e > s ? JSON.parse(raw.slice(s, e + 1)) : {};
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return NextResponse.json({
        actions: [],
        promises: [],
        keyPoints: [],
        openQuestions: [],
        error: "recap timed out",
      });
    }

    const strList = (v: any): string[] =>
      Array.isArray(v)
        ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
        : [];
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions
          .filter(
            (a: any) => a && (typeof a.what === "string") && a.what.trim()
          )
          .map((a: any) => ({
            who: typeof a.who === "string" && a.who.trim() ? a.who.trim() : "Someone",
            what: String(a.what).trim(),
          }))
          .slice(0, 10)
      : [];

    return NextResponse.json({
      actions,
      promises: strList(parsed.promises).slice(0, 8),
      keyPoints: strList(parsed.keyPoints).slice(0, 6),
      openQuestions: strList(parsed.openQuestions).slice(0, 6),
    });
  } catch (err: any) {
    return NextResponse.json(
      { actions: [], promises: [], keyPoints: [], openQuestions: [], error: err?.message || "failed" },
      { status: 200 }
    );
  }
}
