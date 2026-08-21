import { supabaseAdmin } from "@/lib/supabase";
import { resolveRecordScope } from "@/lib/record-scope";

// The global "brain": one editable knowledge base about the user and their
// business (products, sales motion, goals). Read this and prepend it to every
// AI pass so the assistant/synthesis/scoring always reason with the user's
// real-world context. Best-effort - never throws into the caller.
export async function getWorkspaceContext(): Promise<string> {
  try {
    const scope = await resolveRecordScope();
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("knowledge")
      .eq("owner_id", scope.userId)
      .maybeSingle();
    const k = data?.knowledge;
    return typeof k === "string" ? k.trim() : "";
  } catch {
    return "";
  }
}

// A current-hour stamp so AI passes understand today's calendar without changing
// the reusable prompt prefix every minute. UK time, since that's where the user
// works; server-side calendar queries still enforce the exact cutoff.
function nowLine(): string {
  const formatted = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
  });
  return `CURRENT DATE AND HOUR (UK): ${formatted}. Calendar data supplied by the app already applies the exact live cutoff. Never suggest preparing for a call identified as already past.\n\n`;
}

// Wraps the brain in a labelled block for prompts. Always includes the current
// date/time, the curated profile (knowledge), and the auto-learned layer that
// the brain has picked up from calls, emails and chats over time.
export async function workspaceContextBlock(): Promise<string> {
  const now = nowLine();
  let knowledge = "";
  let learned = "";
  let coaching = "";
  try {
    const scope = await resolveRecordScope();
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("knowledge, learned, coaching")
      .eq("owner_id", scope.userId)
      .maybeSingle();
    knowledge = typeof data?.knowledge === "string" ? data.knowledge.trim() : "";
    learned = typeof data?.learned === "string" ? data.learned.trim() : "";
    coaching = typeof data?.coaching === "string" ? data.coaching.trim() : "";
  } catch {
    /* best-effort */
  }
  // Keep the stable brain first for prompt-cache reuse. The changing clock line
  // belongs at the end; putting it first invalidated the whole reusable prefix.
  let out = "";
  if (knowledge)
    out += `ABOUT THE USER AND THEIR BUSINESS (background for everything below - use it to frame your reasoning, never contradict or override the specific data provided later):\n${knowledge.slice(0, 8000)}\n\n`;
  if (learned)
    out += `WHAT YOU HAVE LEARNED SO FAR (durable patterns picked up from the user's calls, emails and chats - apply them, but treat them as secondary to the curated profile above and to the specific data provided later):\n${learned.slice(-4000)}\n\n`;
  if (coaching)
    out += `THE USER'S DEVELOPMENT (what they are training toward: becoming a world-class technology expert in systems development and AI concepts, and articulating why their products fit each client's scenario - plus their pitch and closing habits. These are their recurring areas to improve and their strengths, learned from past calls. Coach gently toward these, build on the strengths, and help them close the gaps at the right moments):\n${coaching.slice(0, 2500)}\n\n`;
  return out + now;
}

// The user's honest, grounded stances on the objections that recur across
// calls (their real product truth: what it does and does not do, where they
// are genuinely weak, what they must not overclaim). Fed into the battlecard
// generator and the live objection coaching so objection-handling is grounded
// in fact, not invented. Empty string if unset.
export async function getObjectionStancesBlock(): Promise<string> {
  try {
    const scope = await resolveRecordScope();
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("objection_stances")
      .eq("owner_id", scope.userId)
      .maybeSingle();
    const s =
      typeof data?.objection_stances === "string"
        ? data.objection_stances.trim()
        : "";
    if (!s) return "";
    return `YOUR HONEST STANCES ON RECURRING OBJECTIONS (ground all objection handling in these, never claim more than is written here, and where a point says CONFIRM be straight about where you actually are rather than inventing an audit, a number or a certification):\n${s}\n\n`;
  } catch {
    return "";
  }
}

// The brain's open questions about the user's business (gaps it wants filled).
// Surfaced to the assistant so it can raise them naturally and brainstorm.
export async function getBrainQuestions(): Promise<string> {
  try {
    const scope = await resolveRecordScope();
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("open_questions")
      .eq("owner_id", scope.userId)
      .maybeSingle();
    return typeof data?.open_questions === "string"
      ? data.open_questions.trim()
      : "";
  } catch {
    return "";
  }
}

// The lessons library, optionally filtered to specific topics, as a labelled
// prompt block. This is the "skills" layer - the negotiation / psychology /
// strategy principles the user has taught the system. Pull only the topics a
// given task needs so prompts stay focused. Empty string if none.
export async function getLessonsBlock(topics?: string[]): Promise<string> {
  try {
    let q = supabaseAdmin
      .from("lessons")
      .select("topic, content")
      .order("created_at", { ascending: false })
      .limit(12);
    if (topics && topics.length) q = q.in("topic", topics);
    const { data } = await q;
    const rows = (data || []).filter(
      (r: any) => typeof r.content === "string" && r.content.trim()
    );
    if (!rows.length) return "";
    const body = rows
      .map((r: any) => `[${r.topic}]\n${String(r.content).trim()}`)
      .join("\n\n")
      .slice(0, 6000);
    return `LESSONS THE USER HAS TAUGHT YOU (apply the relevant ones as your operating principles - negotiation, reading people, strategy):\n${body}\n\n`;
  } catch {
    return "";
  }
}

const PITCH_STOP_WORDS = new Set([
  "about", "after", "again", "against", "could", "from", "have", "into",
  "just", "more", "should", "that", "their", "there", "these", "they",
  "this", "what", "when", "where", "which", "with", "would", "your",
  "pitch", "pitching", "playbook", "sales", "sell", "selling", "question",
  "questions", "objection", "objections", "script", "help", "best",
]);

const pitchTerms = (message: string): string[] =>
  [...new Set(
    String(message || "")
      .toLowerCase()
      .replace(/[^a-z0-9£]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !PITCH_STOP_WORDS.has(term))
  )].slice(0, 12);

const list = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim()).slice(0, limit)
    : [];

// Pitching chapters can be large. The Brain only loads this compact, ranked
// view when the user explicitly asks about selling, questions, objections or
// the playbook. The full approved lesson stays searchable and downloadable in
// the CRM without being paid for on every Brain turn.
export async function getRelevantPitchingLessons(message: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from("lessons")
      .select("title, content, created_at")
      .eq("topic", "pitching")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw error;
    const terms = pitchTerms(message);
    const rows = (data || [])
      .map((row: any, index: number) => {
        let content: any = {};
        try {
          content = JSON.parse(String(row.content || "{}"));
        } catch {
          content = {};
        }
        const haystack = `${row.title || ""} ${row.content || ""}`.toLowerCase();
        const relevance = terms.reduce(
          (score, term) => score + (haystack.includes(term) ? 4 : 0),
          0
        );
        return { row, content, relevance, recency: Math.max(0, 60 - index) / 100 };
      })
      .sort((a, b) => b.relevance + b.recency - (a.relevance + a.recency))
      .slice(0, 3);
    if (!rows.length) return "";

    const chapters = rows.map(({ row, content }) => {
      const parts = [
        `LESSON: ${String(row.title || "Pitching lesson").slice(0, 220)}`,
        content.scenario ? `Use when: ${String(content.scenario).slice(0, 300)}` : "",
        content.audience ? `Audience: ${String(content.audience).slice(0, 220)}` : "",
        list(content.questionsThatWorked, 3).length
          ? `Seller questions that worked: ${list(content.questionsThatWorked, 3).join(" | ")}`
          : "",
        list(content.pitchMoves, 3).length
          ? `Pitch moves: ${list(content.pitchMoves, 3).join(" | ")}`
          : "",
        Array.isArray(content.objections) && content.objections.length
          ? `Objections: ${content.objections.slice(0, 2).map((item: any) => `${String(item?.signal || "").slice(0, 150)} -> ${String(item?.response || "").slice(0, 240)}`).join(" | ")}`
          : "",
        list(content.script, 4).length
          ? `Conversation path: ${list(content.script, 4).join(" | ")}`
          : "",
      ].filter(Boolean);
      return parts.join("\n");
    });
    return `RELEVANT APPROVED PITCHING LESSONS (retrieved on demand from real calls; adapt them to the current buyer and never invent proof):\n${chapters.join("\n\n")}\n\n`;
  } catch {
    return "";
  }
}

// The host's CUE TASTE, learned from their own thumbs up/down (and the cues they
// favourited) on past calls. This closes the learning loop: the live coach leans
// toward the kind of cue the host keeps liking and away from what they reject.
// Compact and best-effort, so it can sit in the latency-sensitive cue prompt.
export async function getTasteBlock(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("call_feedback")
      .select("liked, disliked, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    const seen = new Set<string>();
    const liked: string[] = [];
    const disliked: string[] = [];
    const take = (arr: any, into: string[]) => {
      for (const x of Array.isArray(arr) ? arr : []) {
        const t =
          x && typeof x.text === "string" ? x.text.trim().replace(/\s+/g, " ") : "";
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        if (into.length < 10) into.push(t);
      }
    };
    for (const r of data || []) {
      take((r as any).liked, liked);
      take((r as any).disliked, disliked);
    }
    if (!liked.length && !disliked.length) return "";
    let s =
      "THE HOST'S CUE TASTE (learned from their thumbs up/down and the cues they kept on past calls - match this taste):\n";
    if (liked.length)
      s += `Cues they LIKED (lean toward this kind of question, angle and phrasing):\n${liked
        .map((t) => `- ${t}`)
        .join("\n")}\n`;
    if (disliked.length)
      s += `Cues they DISLIKED (avoid this kind):\n${disliked
        .map((t) => `- ${t}`)
        .join("\n")}\n`;
    return s + "\n";
  } catch {
    return "";
  }
}

// How the host likes to be COACHED on their speaking, learned from their thumbs
// up/down on past speaking-debrief points. Feeds the next debrief so the coach
// gets better at coaching this particular person.
export async function getCoachingTasteBlock(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("coaching_points")
      .select("better, why, vote, created_at")
      .neq("vote", 0)
      .order("created_at", { ascending: false })
      .limit(40);
    const liked: string[] = [];
    const disliked: string[] = [];
    for (const r of data || []) {
      const better = String((r as any).better || "").trim();
      if (!better) continue;
      const why = String((r as any).why || "").trim();
      const line = why ? `${better} (${why})` : better;
      const v = Number((r as any).vote) || 0;
      if (v > 0 && liked.length < 12) liked.push(line);
      else if (v < 0 && disliked.length < 12) disliked.push(line);
    }
    if (!liked.length && !disliked.length) return "";
    let s =
      "HOW THE HOST LIKES TO BE COACHED (learned from their thumbs on past speaking-coaching - match this style of feedback):\n";
    if (liked.length)
      s += `Coaching they found USEFUL (give more like this):\n${liked
        .map((t) => `- ${t}`)
        .join("\n")}\n`;
    if (disliked.length)
      s += `Coaching they REJECTED (do not give this kind):\n${disliked
        .map((t) => `- ${t}`)
        .join("\n")}\n`;
    return s + "\n";
  } catch {
    return "";
  }
}
