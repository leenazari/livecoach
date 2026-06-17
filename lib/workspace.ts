import { supabaseAdmin } from "@/lib/supabase";

// The global "brain": one editable knowledge base about the user and their
// business (products, sales motion, goals). Read this and prepend it to every
// AI pass so the assistant/synthesis/scoring always reason with the user's
// real-world context. Best-effort - never throws into the caller.
export async function getWorkspaceContext(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("knowledge")
      .eq("id", "main")
      .maybeSingle();
    const k = data?.knowledge;
    return typeof k === "string" ? k.trim() : "";
  } catch {
    return "";
  }
}

// A live "now" stamp so every AI pass knows the exact current moment and never
// treats a past meeting as upcoming. UK time, since that's where the user works.
function nowLine(): string {
  const formatted = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `CURRENT DATE AND TIME (UK): ${formatted}. Anything scheduled before this moment has ALREADY HAPPENED - never present a past meeting as upcoming, never suggest preparing for or attending a call whose time has passed, and focus only on what is still ahead.\n\n`;
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
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("knowledge, learned, coaching")
      .eq("id", "main")
      .maybeSingle();
    knowledge = typeof data?.knowledge === "string" ? data.knowledge.trim() : "";
    learned = typeof data?.learned === "string" ? data.learned.trim() : "";
    coaching = typeof data?.coaching === "string" ? data.coaching.trim() : "";
  } catch {
    /* best-effort */
  }
  let out = now;
  if (knowledge)
    out += `ABOUT THE USER AND THEIR BUSINESS (background for everything below - use it to frame your reasoning, never contradict or override the specific data provided later):\n${knowledge}\n\n`;
  if (learned)
    out += `WHAT YOU HAVE LEARNED SO FAR (durable patterns picked up from the user's calls, emails and chats - apply them, but treat them as secondary to the curated profile above and to the specific data provided later):\n${learned}\n\n`;
  if (coaching)
    out += `THE USER'S DEVELOPMENT (what they are training toward: becoming a world-class technology expert in systems development and AI concepts, and articulating why their products fit each client's scenario - plus their pitch and closing habits. These are their recurring areas to improve and their strengths, learned from past calls. Coach gently toward these, build on the strengths, and help them close the gaps at the right moments):\n${coaching}\n\n`;
  return out;
}

// The brain's open questions about the user's business (gaps it wants filled).
// Surfaced to the assistant so it can raise them naturally and brainstorm.
export async function getBrainQuestions(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("open_questions")
      .eq("id", "main")
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
      .limit(60);
    if (topics && topics.length) q = q.in("topic", topics);
    const { data } = await q;
    const rows = (data || []).filter(
      (r: any) => typeof r.content === "string" && r.content.trim()
    );
    if (!rows.length) return "";
    const body = rows
      .map((r: any) => `[${r.topic}]\n${String(r.content).trim()}`)
      .join("\n\n");
    return `LESSONS THE USER HAS TAUGHT YOU (apply the relevant ones as your operating principles - negotiation, reading people, strategy):\n${body}\n\n`;
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
