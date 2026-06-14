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

// Wraps the brain in a labelled block for prompts. Empty string if no brain set.
export async function workspaceContextBlock(): Promise<string> {
  const k = await getWorkspaceContext();
  if (!k) return "";
  return `ABOUT THE USER AND THEIR BUSINESS (background for everything below - use it to frame your reasoning, never contradict or override the specific data provided later):\n${k}\n\n`;
}
