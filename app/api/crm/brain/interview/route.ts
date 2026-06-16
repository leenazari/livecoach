import { NextRequest, NextResponse } from "next/server";
import {
  anthropic,
  CLAUDE_MODEL_THINK,
} from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { workspaceContextBlock } from "@/lib/workspace";
import { upsertTasks, actionToLinkKind } from "@/lib/tasks";
import { logModelUsage } from "@/lib/usage";
import {
  coachSystemBlock,
  CURRICULUM,
  normaliseCoverage,
  pickTopics,
  topicForText,
  type Coverage,
} from "@/lib/brain-coach";

export const runtime = "nodejs";
export const maxDuration = 40;
// Keep this a dynamic function: a no-arg GET would otherwise be statically
// optimised and the POST would 405 (INVALID_REQUEST_METHOD) at the edge.
export const dynamic = "force-dynamic";

// The success coach's interview. It runs on the THINK model (the smartest one)
// and works through a CURRICULUM, asking about the thinnest, highest-impact gap
// it still needs to coach Lee toward the £5M / £650k goal. GET returns the
// questions (its own backlog first, then curriculum-targeted ones). POST folds
// the answer into the brain's learned layer, advances that topic's coverage,
// and spins out any to-dos the answer implies.

// Label for the cost meter: track Opus spend as opus, otherwise sonnet.
const THINK_LABEL: "opus" | "sonnet" = CLAUDE_MODEL_THINK.toLowerCase().includes(
  "opus"
)
  ? "opus"
  : "sonnet";

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
      .select("open_questions, curriculum")
      .eq("id", "main")
      .maybeSingle();

    let questions = parseQuestions(
      typeof data?.open_questions === "string" ? data.open_questions : ""
    );
    const seen = new Set<string>();
    questions = questions.filter((q) => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Top up with curriculum-targeted questions on the THINK model, drilling the
    // thinnest, highest-impact gaps first.
    if (questions.length < 5) {
      try {
        const coverage = normaliseCoverage(data?.curriculum);
        const topics = pickTopics(coverage, 6 - questions.length);
        const biz = await workspaceContextBlock();
        const topicList = topics
          .map((t, i) => `${i + 1}. [${t.key}] ${t.title}: ${t.focus}`)
          .join("\n");
        const msg = await anthropic.messages.create({
          model: CLAUDE_MODEL_THINK,
          max_tokens: 700,
          temperature: 0.5,
          system: `${biz}${coachSystemBlock()}

You are running your daily interview to fill the gaps you most need to coach Lee toward the goal. For EACH topic below, write ONE short, sharp, SPECIFIC question, answerable out loud in a sentence or two, whose answer would most help you move Lee toward the £5M / £650k target. Make every question specific to Lee and the business, not generic, and not something you already know from the context. Output ONLY a JSON array of objects {"topic": the topic key, "q": the question}.`,
          messages: [
            {
              role: "user",
              content: `Topics to cover (thinnest first):\n${topicList}`,
            },
          ],
        });
        await logModelUsage("brain-interview", THINK_LABEL, (msg as any).usage);
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
            const q =
              typeof g === "string"
                ? g
                : g && typeof g.q === "string"
                ? g.q
                : "";
            if (q.trim() && !seen.has(q.toLowerCase())) {
              questions.push(q.trim());
              seen.add(q.toLowerCase());
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
    const validKeys = new Set(CURRICULUM.map((t) => t.key));
    let ack = "Got it, noted.";
    let learning = "";
    let tasks: { text: string; action?: string }[] = [];
    let topicKey: string | null = null;
    let coverageState: "partial" | "solid" = "partial";
    try {
      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL_THINK,
        max_tokens: 600,
        temperature: 0.3,
        system: `${biz}${coachSystemBlock()}

You just asked Lee a question in your daily interview and he answered. Distil it. Output ONLY JSON:
{
 "learning": one concise, durable fact worth remembering long term about Lee, the business, the money, the customers, the plan or his goals, in plain words (max 2 sentences). Empty string if nothing durable.
 "tasks": array of {"text": short imperative to-do under 12 words, "action": "email"|"call"|"task"} for any concrete next actions the answer implies. Empty array if none.
 "topic": which curriculum topic this answer informs, one of: ${CURRICULUM.map((t) => t.key).join(", ")}.
 "coverage": "solid" if the answer gives you a strong, usable understanding of that topic, otherwise "partial".
 "ack": a short, warm one line acknowledgement.
}
Never invent facts beyond what the answer says.`,
        messages: [{ role: "user", content: `Question: ${q}\n\nAnswer: ${a}` }],
      });
      await logModelUsage("brain-interview", THINK_LABEL, (msg as any).usage);
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
      if (typeof parsed.topic === "string" && validKeys.has(parsed.topic))
        topicKey = parsed.topic;
      if (parsed.coverage === "solid") coverageState = "solid";
    } catch {
      /* fall back to just recording the raw answer */
    }
    // If the model didn't tag the topic, infer it from the question text.
    if (!topicKey) topicKey = topicForText(q || a);

    // Read current brain, append the learning, remove the answered question, and
    // advance the curriculum coverage for the topic.
    const { data: prof } = await supabaseAdmin
      .from("workspace_profile")
      .select("learned, open_questions, curriculum")
      .eq("id", "main")
      .maybeSingle();
    const prevLearned =
      typeof prof?.learned === "string" ? prof.learned.trim() : "";
    const note = learning || `${q ? `${q} ` : ""}${a}`.trim();
    let nextLearned = note
      ? `${prevLearned ? prevLearned + "\n" : ""}- ${note}`
      : prevLearned;
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

    const coverage: Coverage = normaliseCoverage(prof?.curriculum);
    if (topicKey && validKeys.has(topicKey)) {
      // Never downgrade a topic that was already solid.
      if (!(coverage[topicKey] === "solid" && coverageState === "partial")) {
        coverage[topicKey] = coverageState;
      }
    }

    await supabaseAdmin
      .from("workspace_profile")
      .update({
        learned: nextLearned,
        open_questions: nextOpen,
        curriculum: coverage,
      })
      .eq("id", "main");

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
