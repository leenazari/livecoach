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
  // For commitments: the prepared, editable action the user approves in-app.
  // e.g. { actionType: "email", subject, body } or { actionType: "task", notes }.
  payload?: Record<string, any> | null;
  dueAt?: string | null; // ISO; parsed from "by Friday" etc.
  pinned?: boolean; // keep at the top of the to-do list until done
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

// ---------------------------------------------------------------------------
// Cross-generator near-duplicate guard.
//
// The exact fingerprint above stops the SAME text being logged twice. It does
// NOT stop two different background jobs (a call recap, a voice debrief, the
// assistant) phrasing the SAME intent slightly differently - e.g. "reschedule
// Matthew" vs "reschedule the call with Matthew", or "Reschedule with Matthew
// Evans, offer two slots" vs "Call Matthew Evans to reschedule". Those slip
// past the exact hash and the user ends up with duplicate to-dos.
//
// This guard is deliberately CONSERVATIVE. It only merges when it is confident,
// because silently burying a genuinely distinct task is worse than the
// occasional duplicate. It merges on two grounds only:
//   1. Restatement - one task's meaningful words are fully contained in the
//      other's (a wordier version of the same thing), sharing >= 2 words.
//   2. Same person + same purpose - they share a proper-noun name AND either
//      two+ shared meaningful (non-generic, non-name) words, or they lead with
//      the same non-generic purpose verb (e.g. both "Reschedule ... Matthew").
// Sharing only a name plus a generic verb (email/send/call/prep...) is NOT
// enough, so "Email Matthew the proposal" and "Email Matthew the invoice" stay
// separate. Validated against the live task list (see dedup_test): 16/16
// labelled pairs correct, 0 false merges across real open tasks.
// ---------------------------------------------------------------------------

// Function/time words. Stripped so they never count as shared meaning.
const STOP_WORDS = new Set([
  "the","a","an","to","with","for","of","on","in","at","and","or","but","if","then",
  "that","this","these","those","my","your","our","their","his","her","its",
  "you","we","they","he","she","it","i","me","us","them",
  "is","are","was","were","be","been","being","do","does","did","done",
  "have","has","had","will","would","should","can","could","may","might","must",
  "about","into","from","by","as","so","once","when","whether","within","up","out",
  "over","after","before","more","most","no","not","any","some","than","very","really",
  "please","just","also","still","yet","now",
  // time words: a shared "tomorrow" or "this week" must not signal a duplicate
  "today","tomorrow","tonight","morning","afternoon","evening","night",
  "week","weeks","day","days","hour","hours","minute","minutes",
  "soon","asap","later","next","monday","tuesday","wednesday","thursday","friday",
  "saturday","sunday","am","pm",
]);

// Generic action / transport verbs - they describe HOW, not the purpose, so
// sharing one (plus a name) is not enough to call two tasks the same. Purpose
// verbs like "reschedule", "cancel", "negotiate", "sign" are intentionally NOT
// here - those carry the meaning of the task.
const GENERIC_VERBS = new Set([
  "email","emails","emailed","send","sends","sent","call","calls","called",
  "message","messages","contact","contacted","follow","followup","followed",
  "draft","drafts","drafted","write","writes","wrote","ping","reach","reached",
  "prep","prepare","prepares","prepared","check","checks","checked","set","setup",
  "get","gets","make","makes","review","reviews","reviewed","wait","waits","waited",
  "decide","decides","schedule","schedules","scheduled","arrange","arranges",
  "ensure","ensures","confirm","confirms","confirmed","discuss","discusses","talk",
  "talks","update","updates","updated","share","shares","shared","chase","chased",
  "note","notes","add","adds","create","creates","book","books","organise",
  "organize","sort","handle","handles","deal","deals","look","looking",
]);

function dedupTokens(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}
// Capitalised words in the ORIGINAL text, excluding the first word (the leading
// imperative verb is usually capitalised too). Returned lower-cased.
function dedupNameSet(text: string): Set<string> {
  const out = new Set<string>();
  String(text || "")
    .trim()
    .split(/\s+/)
    .forEach((w, idx) => {
      if (idx === 0) return;
      const clean = w.replace(/[^A-Za-z0-9]/g, "");
      if (clean.length >= 2 && /^[A-Z]/.test(clean)) out.add(clean.toLowerCase());
    });
  return out;
}
function dedupContentSet(text: string): Set<string> {
  return new Set(dedupTokens(text).filter((t) => !STOP_WORDS.has(t)));
}
function dedupSalientSet(text: string): Set<string> {
  const names = dedupNameSet(text);
  return new Set(
    [...dedupContentSet(text)].filter(
      (t) => !GENERIC_VERBS.has(t) && !names.has(t)
    )
  );
}
function dedupLeadVerb(text: string): string {
  const t = dedupTokens(text);
  return t.length ? t[0] : "";
}
function setIntersectSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}
function isSubsetOf(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// True when two task texts (already known to be in the same company scope) are
// near-duplicates of the same underlying intent.
export function isNearDuplicateTask(aText: string, bText: string): boolean {
  const aC = dedupContentSet(aText);
  const bC = dedupContentSet(bText);
  if (!aC.size || !bC.size) return false;
  const sharedC = setIntersectSize(aC, bC);

  // 1. Restatement - the smaller meaning-set sits entirely inside the larger.
  if ((isSubsetOf(aC, bC) || isSubsetOf(bC, aC)) && sharedC >= 2) return true;

  // 2. Same person + same purpose.
  const sharedNames = setIntersectSize(dedupNameSet(aText), dedupNameSet(bText));
  if (sharedNames >= 1) {
    const sharedSalient = setIntersectSize(
      dedupSalientSet(aText),
      dedupSalientSet(bText)
    );
    if (sharedSalient >= 2) return true;
    const la = dedupLeadVerb(aText);
    const lb = dedupLeadVerb(bText);
    const aLeadShared =
      !!la && !GENERIC_VERBS.has(la) && !STOP_WORDS.has(la) && bC.has(la);
    const bLeadShared =
      !!lb && !GENERIC_VERBS.has(lb) && !STOP_WORDS.has(lb) && aC.has(lb);
    if (aLeadShared || bLeadShared) return true;
  }
  return false;
}

// Upsert tasks by fingerprint. onConflict do-nothing: existing rows (open OR
// done) are left untouched, so we never duplicate and never un-complete a
// finished task. Before inserting, we also drop any candidate that is a
// near-duplicate of an already-open task in the same scope, or of an earlier
// candidate in this same batch (see isNearDuplicateTask) - this stops two
// different generators logging the same intent in slightly different words.
// Best-effort - never throws into the caller. Returns the rows that were
// actually inserted (new ones only), so callers can confirm what was added.
export async function upsertTasks(
  companyId: string | null,
  items: NewTask[]
): Promise<any[]> {
  const candidates = (items || []).filter(
    (i) => i && typeof i.text === "string" && i.text.trim()
  );
  if (!candidates.length) return [];

  // Pull the OPEN tasks already in this scope so we can compare against them.
  // We only guard against OPEN tasks: a done/dismissed one is finished, and a
  // similar new one is more likely a genuine fresh action than a duplicate
  // (and exact repeats are still blocked by the fingerprint onConflict).
  let existingOpenTexts: string[] = [];
  try {
    let q = supabaseAdmin.from("tasks").select("text").eq("status", "open");
    q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
    const { data } = await q;
    existingOpenTexts = Array.isArray(data)
      ? data.map((r: any) => String(r.text || "")).filter(Boolean)
      : [];
  } catch (e) {
    // If we can't read existing tasks, fall back to the exact-fingerprint
    // behaviour only (never block task creation on the guard).
    existingOpenTexts = [];
  }

  const keptTexts: string[] = [...existingOpenTexts];
  const rows = candidates
    .filter((i) => {
      const text = i.text.trim();
      // Drop if it near-duplicates anything already open OR an earlier kept
      // candidate from this very batch.
      const dup = keptTexts.some((t) => isNearDuplicateTask(text, t));
      if (dup) return false;
      keptTexts.push(text);
      return true;
    })
    .map((i) => ({
      company_id: companyId,
      text: i.text.trim(),
      kind: i.kind || "next_step",
      link_kind: i.linkKind || "client",
      source: i.source || null,
      source_ref: i.sourceRef || null,
      payload: i.pinned
        ? {
            ...(i.payload && typeof i.payload === "object" ? i.payload : {}),
            pinned: true,
          }
        : i.payload ?? null,
      due_at: i.dueAt || null,
      fingerprint: fingerprintTask(companyId, i.text),
      status: "open",
    }));
  if (!rows.length) return [];
  try {
    const { data } = await supabaseAdmin
      .from("tasks")
      .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select(
        "id, company_id, text, kind, link_kind, status, done_at, created_at, payload, due_at"
      );
    return data || [];
  } catch (e) {
    console.error("upsertTasks failed:", e);
    return [];
  }
}
