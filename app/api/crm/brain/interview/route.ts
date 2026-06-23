import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_THINK } from "@/lib/anthropic";
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

// The success coach's interview. Runs on the THINK model and works through a
// CURRICULUM, drilling the thinnest high-impact gap. It is INTERACTIVE: per
// question the client sends the conversation so far with action "react", and
// the coach either asks ONE more follow-up to get the real detail or reads back
// what it understood and asks Lee to confirm. On action "save" the coach
// distils the whole exchange, advances that topic's coverage, and spins out any
// to-dos. (A legacy one-shot {question, answer} POST still saves directly.)

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

type Turn = { role: "user" | "coach"; text: string };

function convoText(question: string, turns: Turn[]): string {
  const lines = [`You asked: ${question}`];
  for (const t of turns) {
    if (!t || typeof t.text !== "string" || !t.text.trim()) continue;
    lines.push(`${t.role === "coach" ? "You" : "Lee"}: ${t.text.trim()}`);
  }
  return lines.join("\n");
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

// A conversation turn: decide ONE more follow-up, or a brief natural
// acknowledgement that the answer is captured. No "confirm" step: Lee's
// submitted answer is final, so a ready reply just acknowledges, it never asks
// him to confirm or say "have I got that right".
async function react(question: string, turns: Turn[]) {
  const biz = await workspaceContextBlock();
  // After two follow-ups, force a read-back so it never loops forever.
  const followsSoFar = turns.filter((t) => t.role === "coach").length;
  const mustClose = followsSoFar >= 2;
  let reply = "";
  let ready = mustClose;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_THINK,
      max_tokens: 350,
      temperature: 0.4,
      system: `${biz}${coachSystemBlock()}

You are mid-interview. Decide whether you understand Lee's answer well enough to lock it in, or need ONE more short follow-up to get the real, specific detail. ${mustClose ? "You have already followed up enough, so you MUST read back now (ready = true)." : ""} Output ONLY JSON:
{
 "ready": true or false,
 "reply": if ready, a short natural one-line acknowledgement that REFLECTS BACK the key point of Lee's answer as a statement, so he can hear it was captured correctly (for example "Got it, you are prioritising the partnership page this week" or "Noted, the reseller deals are what get you to the target"). Keep it to one line, use ONLY detail Lee actually gave, and phrase it as a plain statement. Do NOT ask Lee to confirm and never say "have I got that right", "let me confirm" or "let me make sure". If not ready, ONE short, sharp follow-up question that drills into what actually matters for the goal.
}
Be brief and conversational. Honest, never flattering. Never invent detail Lee did not give.`,
      messages: [{ role: "user", content: convoText(question, turns) }],
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
    if (typeof parsed.reply === "string" && parsed.reply.trim())
      reply = parsed.reply.trim();
    if (typeof parsed.ready === "boolean") ready = parsed.ready || mustClose;
  } catch {
    ready = true;
    reply = "Got it, noted.";
  }
  if (!reply) reply = "Got it, noted.";
  return NextResponse.json({ ok: true, ready, reply });
}

// Distil the whole exchange, save the durable learning, advance the topic's
// coverage, remove the answered question, and spin out any to-dos.
async function save(question: string, turns: Turn[]) {
  const answerJoined = turns
    .filter((t) => t.role === "user" && t.text && t.text.trim())
    .map((t) => t.text.trim())
    .join(" ");
  if (!answerJoined)
    return NextResponse.json({ ok: false, error: "no answer" });

  const biz = await workspaceContextBlock();
  const validKeys = new Set(CURRICULUM.map((t) => t.key));
  let ack = "Locked in. Thanks.";
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

You just finished a short back and forth with Lee in your daily interview. Distil it. Output ONLY JSON:
{
 "learning": one concise, durable fact worth remembering long term about Lee, the business, the money, the customers, the plan or his goals, in plain words (max 2 sentences). Empty string if nothing durable.
 "tasks": array of {"text": short imperative to-do under 12 words, "action": "email"|"call"|"task"} for any concrete next actions implied. Empty array if none.
 "topic": which curriculum topic this informs, one of: ${CURRICULUM.map((t) => t.key).join(", ")}.
 "coverage": "solid" if you now have a strong, usable understanding of that topic, otherwise "partial".
 "ack": a short, warm one line acknowledgement.
}
Never invent facts beyond what Lee actually said.`,
      messages: [{ role: "user", content: convoText(question, turns) }],
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
    /* fall back to recording the raw answer */
  }
  if (!topicKey) topicKey = topicForText(question || answerJoined);

  const { data: prof } = await supabaseAdmin
    .from("workspace_profile")
    .select("learned, open_questions, curriculum")
    .eq("id", "main")
    .maybeSingle();
  const prevLearned =
    typeof prof?.learned === "string" ? prof.learned.trim() : "";
  const note = learning || `${question ? `${question} ` : ""}${answerJoined}`.trim();
  let nextLearned = note
    ? `${prevLearned ? prevLearned + "\n" : ""}- ${note}`
    : prevLearned;
  if (nextLearned.length > 8000) nextLearned = nextLearned.slice(-8000);

  let nextOpen: string =
    typeof prof?.open_questions === "string" ? prof.open_questions : "";
  if (question) {
    const ql = question.toLowerCase();
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
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const action = body.action === "save" ? "save" : body.action === "react" ? "react" : "";

    // Build the conversation turns. New clients send `turns`; the legacy
    // one-shot client sends a single `answer` and no action.
    let turns: Turn[] = [];
    if (Array.isArray(body.turns)) {
      turns = body.turns
        .filter((t: any) => t && (t.role === "user" || t.role === "coach"))
        .map((t: any) => ({ role: t.role, text: String(t.text || "") }));
    } else if (typeof body.answer === "string") {
      turns = [{ role: "user", text: body.answer }];
    }

    if (action === "react") return await react(question, turns);
    // action "save", or legacy {question, answer}.
    return await save(question, turns);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "failed" });
  }
}
