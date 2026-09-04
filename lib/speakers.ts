import { connectedEmail } from "@/lib/mail";
import { supabaseService } from "@/lib/supabase";

// SPEAKER IDENTITY.
//
// The Meet bot labels every utterance with the participant's Google display
// name, which is whatever that person happened to have set on that device on
// that day. In practice one human shows up under several labels: the same
// account has appeared as "Lee Nazari", "lee nazari", "LEE NAZARI", "L N" and
// "lee". Left alone that splits one person into five owners in an action list,
// which is worse than useless - you chase yourself for a commitment.
//
// It is also why the `role` column cannot be trusted to tell you who the host
// is. The same person is tagged "guest" on some sessions and "host" on others,
// depending on who started the meeting. Name matching is the source of truth.
//
// House style: no em dashes, no semicolons.

// Squash a display name to something comparable: lowercase, no punctuation,
// single spaces. "L.N." and "l n" both become "l n".
export function normalise(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[._\-']/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The initials of a full name, so "Lee Nazari" also answers to "L N".
function initialsOf(name: string): string {
  const parts = normalise(name).split(" ").filter(Boolean);
  if (parts.length < 2) return "";
  return parts.map((p) => p[0]).join(" ");
}

// Everything a given person might be labelled as: the full name, each single
// name part, and the initials form.
export function aliasesFor(fullName: string): Set<string> {
  const out = new Set<string>();
  const n = normalise(fullName);
  if (!n) return out;
  out.add(n);
  const parts = n.split(" ").filter(Boolean);
  // A lone first name only counts as an alias when it is distinctive enough to
  // be worth the risk. Two letters is not.
  for (const p of parts) if (p.length >= 3) out.add(p);
  const init = initialsOf(fullName);
  if (init) {
    out.add(init);
    out.add(init.replace(/ /g, ""));
  }
  return out;
}

export type SpeakerMap = {
  // The canonical name for the host, e.g. "Lee Nazari".
  me: string;
  meAliases: Set<string>;
  // Everyone else seen on the call, canonical name keyed by normalised label.
  canonical: Map<string, string>;
};

// Who the host is. Read from the user's connected email account and workspace
// profile rather than hardcoded, so this does not rot the moment someone else
// uses the app.
export async function loadHostIdentity(): Promise<{
  name: string;
  email: string;
}> {
  const email = await connectedEmail();

  // A name from the email local part is a decent fallback when nothing better
  // exists: lee.nazari@ becomes "Lee Nazari".
  const local = email.split("@")[0] || "";
  const guessed = local
    .replace(/[._+-]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return { name: guessed, email };
}

// Shared calls can be launched by one attendee while another verified member
// is the calendar organiser and actual host. Callers must derive ownerId from
// the exact shared-call access record, never from browser input.
export async function loadHostIdentityForUser(
  ownerId: string,
  workspaceId: string
): Promise<{ name: string; email: string }> {
  const [{ data: profile }, { data: google }, { data: microsoft }] =
    await Promise.all([
      supabaseService
        .from("profiles")
        .select("display_name,email")
        .eq("user_id", ownerId)
        .maybeSingle(),
      supabaseService
        .from("google_oauth")
        .select("email")
        .eq("workspace_id", workspaceId)
        .eq("owner_id", ownerId)
        .maybeSingle(),
      supabaseService
        .from("microsoft_oauth")
        .select("email")
        .eq("workspace_id", workspaceId)
        .eq("owner_id", ownerId)
        .maybeSingle(),
    ]);
  const email = String(google?.email || microsoft?.email || profile?.email || "")
    .trim()
    .toLowerCase();
  const guessed = (email.split("@")[0] || "")
    .replace(/[._+-]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return {
    name: String(profile?.display_name || guessed || "Host").trim(),
    email,
  };
}

// Build a map that collapses every label seen in a set of utterances onto one
// canonical name per human.
//
// The rule: the LONGEST, best-capitalised label wins as the canonical form, so
// "Lee Nazari" beats "lee" and "L N". Anything matching the host's aliases
// collapses onto the host name regardless of how it was spelled.
export function buildSpeakerMap(
  labels: string[],
  hostName: string
): SpeakerMap {
  const meAliases = aliasesFor(hostName);
  const canonical = new Map<string, string>();

  // Group the labels by normalised form first, keeping the nicest spelling.
  const best = new Map<string, string>();
  for (const raw of labels) {
    const label = String(raw || "").trim();
    if (!label) continue;
    const n = normalise(label);
    if (!n) continue;
    const current = best.get(n);
    if (!current || score(label) > score(current)) best.set(n, label);
  }

  // Then fold aliases of the same human together. Two normalised labels belong
  // to the same person when one is a subset of the other's alias set, which
  // catches "lee" inside "lee nazari" without merging "Steve" and "Steven".
  const groups: { canonical: string; keys: string[] }[] = [];
  for (const [n, label] of best) {
    const al = aliasesFor(label);
    const hit = groups.find(
      (g) =>
        aliasesFor(g.canonical).has(n) ||
        al.has(normalise(g.canonical)) ||
        [...al].some((a) => aliasesFor(g.canonical).has(a))
    );
    if (hit) {
      hit.keys.push(n);
      // Keep the fullest name as the group's label.
      if (score(label) > score(hit.canonical)) hit.canonical = label;
    } else {
      groups.push({ canonical: label, keys: [n] });
    }
  }

  for (const g of groups) {
    const isMe = g.keys.some((k) => meAliases.has(k)) ;
    const name = isMe && hostName ? hostName : g.canonical;
    for (const k of g.keys) canonical.set(k, name);
  }

  return { me: hostName, meAliases, canonical };
}

// A label's quality: more name parts is better, proper capitalisation breaks
// ties. "Lee Nazari" scores above "LEE NAZARI" scores above "lee".
function score(label: string): number {
  const parts = normalise(label).split(" ").filter(Boolean);
  let s = parts.length * 10 + normalise(label).length;
  if (/^[A-Z][a-z]/.test(label)) s += 5;
  if (label === label.toUpperCase() && label.length > 3) s -= 3;
  return s;
}

// The canonical name for one raw label. Unknown or blank labels come back as
// "" so the caller can show them as unattributed rather than guessing an
// owner - a wrongly assigned action is worse than an unassigned one.
export function canonicalName(map: SpeakerMap, raw: string): string {
  const n = normalise(raw);
  if (!n) return "";
  return map.canonical.get(n) || String(raw || "").trim();
}

export function isHost(map: SpeakerMap, raw: string): boolean {
  const n = normalise(raw);
  if (!n) return false;
  if (map.meAliases.has(n)) return true;
  return (map.canonical.get(n) || "") === map.me && !!map.me;
}
