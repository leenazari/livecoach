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
// date/time so the model reasons against the real "now"; adds the brain when set.
export async function workspaceContextBlock(): Promise<string> {
  const k = await getWorkspaceContext();
  const now = nowLine();
  if (!k) return now;
  return `${now}ABOUT THE USER AND THEIR BUSINESS (background for everything below - use it to frame your reasoning, never contradict or override the specific data provided later):\n${k}\n\n`;
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
