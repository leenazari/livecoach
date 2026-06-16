import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 20;

// The FAST top half of the post-call summary: a verdict, how it went, and the
// next actions, so the caller can start reading immediately while the full
// scorecard (strengths, scoring, question review) generates separately. Haiku +
// low tokens so it lands in a couple of seconds. NOT persisted - the full
// summary route is the saved record.
export async function POST(req: NextRequest) {
  try {
    const { transcript, role, candidate, competencies } = await req.json();
    const t = typeof transcript === "string" ? transcript.trim() : "";
    if (t.length < 30) return NextResponse.json({});
    const focus =
      Array.isArray(competencies) && competencies.length
        ? `\nThe caller's focus areas were: ${competencies.join(", ")}.`
        : "";

    const system = `You write the QUICK top of a call summary so the caller can read it the moment the call ends. From the transcript give ONLY:
- recommendation: a 2-5 word verdict or next move (e.g. "Worth pursuing", "Send the proposal", "Strong fit").
- headline: one sentence on how it went.
- overview: 1-2 sentences of context.
- myNextActions: what the CALLER should do next - short imperative lines, name who if relevant.
- theirNextActions: what the OTHER party said they will do next.
- suggestedNextActions: 0-3 smart moves the caller could make.
Ground ONLY in the transcript. Never invent names, numbers, amounts, dates or commitments. Keep everything short.${focus}
Output ONLY JSON: {"recommendation":"...","headline":"...","overview":"...","myNextActions":["..."],"theirNextActions":["..."],"suggestedNextActions":["..."]}`;

    const user = `${candidate ? `Other party: ${candidate}\n` : ""}${
      role ? `Role / title: ${role}\n` : ""
    }TRANSCRIPT:\n${t.slice(-9000)}\n\nReturn the JSON now.`;

    let parsed: any = {};
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_LIVE,
            max_tokens: 700,
            temperature: 0.3,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("summary-top", "haiku", (msg as any).usage);
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
      return NextResponse.json({});
    }

    const list = (v: any): string[] =>
      Array.isArray(v)
        ? v.filter((x: any) => typeof x === "string" && x.trim()).map((x: any) => x.trim()).slice(0, 8)
        : [];

    return NextResponse.json({
      recommendation:
        typeof parsed.recommendation === "string" ? parsed.recommendation : "",
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      overview: typeof parsed.overview === "string" ? parsed.overview : "",
      myNextActions: list(parsed.myNextActions),
      theirNextActions: list(parsed.theirNextActions),
      suggestedNextActions: list(parsed.suggestedNextActions),
      partial: true,
    });
  } catch (err: any) {
    return NextResponse.json({});
  }
}
