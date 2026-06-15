import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

// A stable fingerprint per (company, action). Same action for the same client
// always hashes the same, so a task is never created twice and a completed one
// is never resurrected when an AI pass regenerates it.
export function fingerprintTask(companyId: string | null, text: string): string {
  const norm = (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  return createHash("sha256")
    .update(`${companyId || "global"}::${norm}`)
    .digest("hex");
}

export type NewTask = {
  text: string;
  kind?: string; // next_step | commitment | draft | manual
  linkKind?: string; // client | drafts | call | email
  source?: string; // synthesis | call | manual | follow_up | assistant | debrief
  sourceRef?: string | null;
};

// Map a spoken/loose action word to the to-do's link_kind, which drives the
// action chip in the list (draft email, prep call, open client). "email" and
// "draft" become an email-draft action, "call"/"prep" a call action, the rest
// just open the client.
export function actionToLinkKind(action?: string): string {
  const a = (action || "").toLowerCase().trim();
  if (a === "email" || a === "draft" || a === "follow-up" || a === "followup")
    return "email";
  if (a === "call" || a === "prep" || a === "meeting" || a === "schedule")
    return "call";
  if (a === "drafts") return "drafts";
  return "client";
}

// Upsert tasks by fingerprint. onConflict do-nothing: existing rows (open OR
// done) are left untouched, so we never duplicate and never un-complete a
// finished task. Best-effort - never throws into the caller. Returns the rows
// that were actually inserted (new ones only), so callers can confirm what was
// added.
export async function upsertTasks(
  companyId: string | null,
  items: NewTask[]
): Promise<any[]> {
  const rows = (items || [])
    .filter((i) => i && typeof i.text === "string" && i.text.trim())
    .map((i) => ({
      company_id: companyId,
      text: i.text.trim(),
      kind: i.kind || "next_step",
      link_kind: i.linkKind || "client",
      source: i.source || null,
      source_ref: i.sourceRef || null,
      fingerprint: fingerprintTask(companyId, i.text),
      status: "open",
    }));
  if (!rows.length) return [];
  try {
    const { data } = await supabaseAdmin
      .from("tasks")
      .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id, company_id, text, kind, link_kind, status, done_at, created_at");
    return data || [];
  } catch (e) {
    console.error("upsertTasks failed:", e);
    return [];
  }
}
