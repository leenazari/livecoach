import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { workspaceContextBlock } from "@/lib/workspace";
import { upsertTasks, actionToLinkKind } from "@/lib/tasks";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 30;
// Keep this a dynamic function: a no-arg GET would otherwise be statically
// optimised and the POST would 405 (INVALID_REQUEST_METHOD) at the edge.
export const dynamic = "force-dynamic";

// The brain's morning interview. GET returns a handful of questions the brain
// wants answered (its own open questions first, topped up with freshly generated
// ones). POST folds the user's spoken answer back into the brain's learned layer
// and clears the question, optionally spinning out any to-dos the answer implies.

// Split the stored open_questions blob into clean individual questions.
function parseQuestions(blob: string): string[] {
  return (blob || "")
    .split(/\n+/)
    .map((l) =>
      l
        .replace(/^\s*[-*•]\s*/, "")
        .replace(/^\s*\d+[.)]\s*/, "")
        .replace(/^\s*(Q\d*[:.)]?)\s*/i, "")
        .trim()
    )
    .filter((l) => l.length > 6);
}

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("open_questions")
      .eq("id", "main")
      .maybeSingle();
    let questions = parseQuestions(
      typeof data?.open_questions === "string" ? data.open_questions : ""
    );
    // Dedupe (case-insensitive) and cap.
    const seen = new Set<string>();
    questions = questions.filter((q) => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Top up to ~6 with freshly generated questions grounded in the brain, so
    // the morning interview is always useful even on a quiet day.
    if (questions.length < 5) {
      try {
        const need = 6 - questions.length;
        const biz = await workspaceContextBlock();
        const msg = await anthropic.messages.create({
          model: CLAUDE_MODEL_LIVE,
          max_tokens: 500,
          temperature: 0.6,
          system: `${biz}You are the user's AI brain. Ask short questions you genuinely want answered to (a) understand the user and their business better, or (b) help them brainstorm today's priorities and next steps. Mix both kinds. Each question must be specific to THIS user and answerable in a sentence or two out loud. Avoid generic or already-obvious questions. Output ONLY a JSON array of ${need} question strings.`,
          messages: [
            {
              role: "user",
              content:
                "Give me your questions for this morning as a JSON array of strings.",
            },
          ],
        });
        await logModelUsage("brain-interview", "haiku", (msg as any).usage);
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
        const a = raw.indexOf("[");
        const b = raw.lastIndexOf("]");
        const gen = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : [];
        if (Array.isArray(gen)) {
          for (const g of gen) {
            if (typeof g === "string" && g.trim() && !seen.has(g.toLowerCase())) {
              questions.push(g.trim());
              seen.add(g.toLowerCase());
            }
          }
        }
      } catch {
        /* generation is best-effort */
      }
    }

    return NextResponse.json({ questions: questions.slice(0, 8) });
  } catch (err: any) {
    return NextResponse.json({ questions: [], error: err?.message || "failed" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { question, answer } = await req.json();
    const q = typeof question === "string" ? question.trim() : "";
    const a = typeof answer === "string" ? answer.trim() : "";
    if (!a) return NextResponse.json({ ok: false, error: "no answer" });

    const biz = await workspaceContextBlock();
    let ack = "Got it, noted.";
    let learning = "";
    let tasks: { text: string; action?: string }[] = [];
    try {
      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL_LIVE,
        max_tokens: 500,
        temperature: 0.3,
        system: `${biz}You are the user's AI brain, learning from a quick spoken Q&A so you understand them better over time. Given the question you asked and the user's answer, output ONLY JSON:
{
 "learning": one concise, durable fact worth remembering long-term about the user, their business, preferences or goals, in plain words (max 2 sentences). Empty string if the answer holds nothing durable.
 "tasks": array of {"text": short imperative to-do under 12 words, "action": "email"|"call"|"task"} for any concrete next actions the answer implies (e.g. they said they need to do X). Empty array if none.
 "ack": a short, warm one-line acknowledgement.
}
Never invent facts beyond what the answer says. No em dashes or semicolons.`,
        messages: [
          { role: "user", content: `Question: ${q}\n\nAnswer: ${a}` },
        ],
      });
      await logModelUsage("brain-interview", "haiku", (msg as any).usage);
      const raw = msg.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("")
        .trim();
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      const parsed = s >= 0 && e > s ? JSON.parse(raw.slice(s, e + 1)) : {};
      if (typeof parsed.learning === "string") learning = parsed.learning.trim();
      if (typeof parsed.ack === "string" && parsed.ack.trim())
        ack = parsed.ack.trim();
      if (Array.isArray(parsed.tasks)) tasks = parsed.tasks;
    } catch {
      /* fall back to just recording the raw answer */
    }

    // Read current brain, append the learning, and remove the answered question.
    const { data: prof } = await supabaseAdmin
      .from("workspace_profile")
      .select("learned, open_questions")
      .eq("id", "main")
      .maybeSingle();
    const prevLearned =
      typeof prof?.learned === "string" ? prof.learned.trim() : "";
    const note = learning || `${q ? `${q} ` : ""}${a}`.trim();
    let nextLearned = note
      ? `${prevLearned ? prevLearned + "\n" : ""}- ${note}`
      : prevLearned;
    // Keep the learned layer from growing without bound.
    if (nextLearned.length > 8000) nextLearned = nextLearned.slice(-8000);

    let nextOpen: string =
      typeof prof?.open_questions === "string" ? prof.open_questions : "";
    if (q) {
      const ql = q.toLowerCase();
      nextOpen = nextOpen
        .split(/\n+/)
        .filter((line: string) => {
          const clean = line
            .replace(/^\s*[-*•]\s*/, "")
            .replace(/^\s*\d+[.)]\s*/, "")
            .trim()
            .toLowerCase();
          return clean && clean !== ql;
        })
        .join("\n");
    }

    await supabaseAdmin
      .from("workspace_profile")
      .update({ learned: nextLearned, open_questions: nextOpen })
      .eq("id", "main");

    // Spin out any to-dos the answer implied (global, not tied to a client).
    const clean = tasks
      .filter((t) => t && typeof t.text === "string" && t.text.trim())
      .slice(0, 6)
      .map((t) => ({
        text: String(t.text).trim(),
        linkKind: actionToLinkKind(t.action),
        source: "brain",
      }));
    const createdTasks = clean.length ? await upsertTasks(null, clean) : [];

    return NextResponse.json({ ok: true, ack, createdTasks });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "failed" });
  }
}
