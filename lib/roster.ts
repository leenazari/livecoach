// Roster matching: link a recorded call to the right client by WHO was on it,
// not just the name. This is what tells the two standups apart - they share
// people (Mark + Jay) but the wider Dev & Design call also has Taash and Katuk,
// so the attendee SET is the signal. Each client carries a learned roster
// (profile.roster: first-name token -> times seen), grown every time a call is
// assigned, so recurring meetings auto-link with zero manual work.

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Match people by FIRST name token - standups are referenced as "Jay", "Taash",
// or "Mark Darling", and the first name is the stable key across those.
const firstToken = (name: string) => norm(name).split(" ")[0] || "";

// Speaker labels that are the host or generic, never a roster member.
const HOST_OR_GENERIC = new Set([
  "lee",
  "lee nazari",
  "you",
  "host",
  "interviewer",
  "candidate",
  "speaker",
  "me",
]);

// Pull the distinct attendees (first-name tokens) from a speaker-labelled
// transcript, excluding the host and generic labels.
export function extractAttendees(transcript: string): Set<string> {
  const out = new Set<string>();
  for (const line of String(transcript || "").split(/\n+/)) {
    const m = line.match(/^([^:]{1,40}):\s/);
    if (!m) continue;
    const raw = m[1].trim();
    const n = norm(raw);
    if (!n || HOST_OR_GENERIC.has(n)) continue;
    const ft = firstToken(raw);
    if (ft.length >= 2 && !HOST_OR_GENERIC.has(ft)) out.add(ft);
  }
  return out;
}

// The "core" roster of a client: people seen at least twice (or everyone, for a
// client with little history / a freshly seeded roster).
export function rosterCore(profile: any): Set<string> {
  const r =
    profile && typeof profile === "object" && profile.roster &&
    typeof profile.roster === "object"
      ? (profile.roster as Record<string, any>)
      : null;
  if (!r) return new Set();
  const total = Object.values(r).reduce(
    (a: number, b: any) => a + (Number(b) || 0),
    0
  );
  const core = new Set<string>();
  for (const [k, v] of Object.entries(r)) {
    const c = Number(v) || 0;
    if (c >= 2 || total <= 3) core.add(k);
  }
  return core;
}

// Best client by attendee-set overlap (Jaccard). Conservative: needs at least
// two shared people, a strong overlap, and a clear winner, so it can't link a
// one-name coincidence or guess between two close rosters.
export function matchByRoster(
  attendees: Set<string>,
  companies: { id: string; profile?: any }[]
): { companyId: string; score: number } | null {
  if (attendees.size < 2) return null;
  let best: { id: string; j: number } | null = null;
  let second = 0;
  for (const c of companies || []) {
    const core = rosterCore(c.profile);
    if (core.size < 2) continue;
    let inter = 0;
    for (const a of attendees) if (core.has(a)) inter++;
    if (inter < 2) continue;
    const union = new Set([...Array.from(attendees), ...Array.from(core)]).size;
    const j = union ? inter / union : 0;
    if (!best || j > best.j) {
      second = best ? best.j : 0;
      best = { id: c.id, j };
    } else if (j > second) {
      second = j;
    }
  }
  if (best && best.j >= 0.6 && best.j - second >= 0.1) {
    return { companyId: best.id, score: best.j };
  }
  return null;
}

// Fold a call's attendees into a client's roster (counts), returning the updated
// profile object. Used when a call is assigned, so the roster firms up over time.
export function mergeRoster(profile: any, attendees: Set<string>): any {
  const p: any = { ...(profile && typeof profile === "object" ? profile : {}) };
  const r: Record<string, number> = {
    ...(p.roster && typeof p.roster === "object" ? p.roster : {}),
  };
  for (const a of Array.from(attendees)) {
    if (!a) continue;
    r[a] = (Number(r[a]) || 0) + 1;
  }
  p.roster = r;
  return p;
}
