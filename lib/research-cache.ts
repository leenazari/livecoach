import { supabaseAdmin } from "@/lib/supabase";

// RESEARCH CACHE.
//
// The prep chain researches the COMPANY and the PERSON you are about to meet,
// then builds the intent, the focus and the plan from them. Research is the
// expensive part (Opus plus web search), so it must be bought ONCE PER ENTITY,
// not once per meeting:
//
//   company research  -> companies.profile.research     (never expires)
//   person research   -> contacts.attributes.research   (fresh for 90 days)
//
// Both are also mirrored onto the scheduled call as upcoming_calls.research,
// with a single merged `background` string, because that is the exact shape the
// live call screen already reloads and the planner already folds into the focus.
// Mirroring keeps the call screen working with no change to it at all.
//
// House style: no em dashes, no semicolons.

// HOW LONG A BRIEF COUNTS AS GOOD.
//
// 0 means never expires: bought once and reused for every call with that entity
// from then on, until you force a refresh by hand. A positive number of days
// means the chain quietly re-researches once the brief is older than that.
//
// The company brief NEVER expires. What an organisation does and how it buys
// moves slowly, and this is the expensive one, so it is bought once per client
// and reused forever. The prep screen shows its age with a refresh link, and
// flags it past 90 days so an obviously old brief is not driving a call unseen.
//
// The person brief expires after 90 days. People move jobs, change title and
// change what they care about far faster than their employer does, and briefing
// someone on a role they left is worse than having no brief at all.
export const COMPANY_TTL_DAYS = 0;
export const PERSON_TTL_DAYS = 90;

export type ResearchSource = { title: string; url: string };

export type EntityResearch = {
  // Who or what this brief is about, as researched.
  subject: string;
  // The brief itself. NEVER has a sources list baked into it - sources are held
  // separately so the merged background can carry one combined list.
  background: string;
  sources: ResearchSource[];
  // Only set for people: the confirmed identity from the identify pass.
  identity?: any;
  generatedAt: string;
};

export type EntityState = {
  have: boolean;
  fresh: boolean;
  generatedAt: string | null;
  subject: string;
  background: string;
  sources: ResearchSource[];
};

export const EMPTY_STATE: EntityState = {
  have: false,
  fresh: false,
  generatedAt: null,
  subject: "",
  background: "",
  sources: [],
};

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

// ttlDays of 0 (or less) means "never expires", which is the configured default.
// Anything already on file counts as fresh and is reused until you force a
// refresh by hand.
export function isFresh(generatedAt: any, ttlDays: number): boolean {
  if (typeof generatedAt !== "string" || !generatedAt) return false;
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return true;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < ttlDays * 24 * 60 * 60 * 1000;
}

export function toState(
  research: any,
  ttlDays: number
): EntityState {
  if (!research || typeof research !== "object") return { ...EMPTY_STATE };
  const background =
    typeof research.background === "string" ? research.background : "";
  if (!background.trim()) return { ...EMPTY_STATE };
  return {
    have: true,
    fresh: isFresh(research.generatedAt, ttlDays),
    generatedAt:
      typeof research.generatedAt === "string" ? research.generatedAt : null,
    subject: typeof research.subject === "string" ? research.subject : "",
    background,
    sources: Array.isArray(research.sources)
      ? research.sources.filter(
          (s: any) => s && typeof s.url === "string" && s.url
        )
      : [],
  };
}

// ---------------------------------------------------------------------------
// Identity helpers. Mirrors the client-side copies in app/call/page.tsx - kept
// here so the server can resolve who a meeting is with without the call screen.
// ---------------------------------------------------------------------------

export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.co.uk", "live.com",
  "live.co.uk", "msn.com", "btinternet.com", "sky.com", "mail.com", "zoho.com",
  "fastmail.com", "yandex.com", "qq.com", "163.com",
]);

export function emailDomain(email: string): string {
  const m = String(email || "").toLowerCase().match(/@([^@\s]+)$/);
  return m ? m[1] : "";
}

// A company website guessed from a WORK email domain, or "" for a personal
// inbox (whose domain is a mail host, not the company).
export function websiteFromEmail(email: string): string {
  const d = emailDomain(email);
  return d && !PERSONAL_EMAIL_DOMAINS.has(d) ? `https://${d}` : "";
}

export function nameFromEmail(email: string): string {
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._+-]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

// The person being met, read off a calendar invite's attendee list: the first
// guest who is not me, preferring one on a real work email so the domain gives
// a site to research.
export function pickGuest(
  attendees: any
): { name: string; email: string } | null {
  const list = (Array.isArray(attendees) ? attendees : []).filter(
    (a) => a && typeof a.email === "string" && a.email.trim() && a.self !== true
  );
  if (!list.length) return null;
  const work = list.find((a: any) => websiteFromEmail(a.email));
  const a = work || list[0];
  const name =
    typeof a.displayName === "string" && a.displayName.trim()
      ? a.displayName.trim()
      : nameFromEmail(a.email);
  return { name, email: String(a.email).trim() };
}

// Fallback for invites with NO guest list: read the person and company off the
// title. Handles "Interviewa - Tim Luft (Woote)" plus common intro titles.
export function guestFromTitle(
  title: string
): { name: string; company: string } | null {
  let t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  let company = "";
  const paren = t.match(/\(([^)]+)\)\s*$/);
  if (paren && typeof paren.index === "number") {
    company = paren[1].trim();
    t = t.slice(0, paren.index).trim();
  }

  t = t
    .replace(
      /^(interviewa|interviewer|interview|intro(?:duction)?|demo|call|meeting|catch[\s-]?up|chat|sync|onboarding)\b[\s:\u2013\u2014/|-]*/i,
      ""
    )
    .replace(/^with\s+/i, "")
    .trim();

  const sep = t
    .split(/\s*(?:<->|<>|\/|&|\+|\||\bx\b|\bvs\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sep.length > 1) {
    const notMe = sep.find((s) => !/^(lee|me|lee nazari)$/i.test(s));
    if (notMe) t = notMe;
  }

  const name = t
    .replace(/[\u2013\u2014-]+\s*$/, "")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ")
    .trim();

  if (!name && !company) return null;
  return { name, company };
}

// A LinkedIn slug like "keith-fraser-9987b630" -> "keith fraser", to seed a
// search when no name was given.
export function nameFromLinkedin(url: string): string {
  try {
    const m = String(url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (!m) return "";
    return decodeURIComponent(m[1])
      .split("-")
      .filter((p) => p && !/\d/.test(p))
      .join(" ")
      .trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Company research cache -> companies.profile.research
// ---------------------------------------------------------------------------

export async function loadCompany(companyId: string | null): Promise<any> {
  if (!companyId) return null;
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name, website, domain, sector, profile, email_context")
    .eq("id", companyId)
    .maybeSingle();
  return data || null;
}

export function companyState(company: any): EntityState {
  const profile = (company && company.profile) || {};
  return toState((profile as any).research, COMPANY_TTL_DAYS);
}

// Saves the brief onto the company, PRESERVING every other profile key (the
// battlecard, the running brief, the playbook, the internal flag).
export async function saveCompanyResearch(
  companyId: string,
  research: EntityResearch
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("companies")
    .select("profile")
    .eq("id", companyId)
    .maybeSingle();
  const existing = (data && (data as any).profile) || {};
  await supabaseAdmin
    .from("companies")
    .update({ profile: { ...existing, research } })
    .eq("id", companyId);
}

// ---------------------------------------------------------------------------
// Person research cache -> contacts.attributes.research
// ---------------------------------------------------------------------------

// Find the contact this call is with, or create one so the brief has somewhere
// permanent to live. Matched on email first (exact, case-insensitive), then on
// name within the same company. Returns null only when there is nothing to key
// a contact on at all.
export async function resolveContact(opts: {
  companyId: string | null;
  name?: string;
  email?: string;
  role?: string;
  create?: boolean;
}): Promise<any | null> {
  const name = String(opts.name || "").trim();
  const email = String(opts.email || "").trim().toLowerCase();
  if (!name && !email) return null;

  if (email) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, name, role, email, company_id, attributes")
      .ilike("email", email)
      .limit(1);
    if (data && data.length) return data[0];
  }

  if (name && opts.companyId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, name, role, email, company_id, attributes")
      .eq("company_id", opts.companyId)
      .ilike("name", name)
      .limit(1);
    if (data && data.length) return data[0];
  }

  if (!opts.create) return null;

  // Never create a contact we could never find again. With no company to hang
  // it off AND no email to match it by, the row would be invisible in the CRM
  // and useless as a cache key, so we skip the cache rather than litter.
  if (!opts.companyId && !email) return null;

  const row: Record<string, any> = {
    name: name || nameFromEmail(email) || "Unknown",
    company_id: opts.companyId || null,
  };
  if (email) row.email = email;
  if (opts.role && opts.role.trim()) row.role = opts.role.trim();

  const { data: created } = await supabaseAdmin
    .from("contacts")
    .insert(row)
    .select("id, name, role, email, company_id, attributes")
    .single();
  return created || null;
}

export function personState(contact: any): EntityState {
  const attrs = (contact && contact.attributes) || {};
  return toState((attrs as any).research, PERSON_TTL_DAYS);
}

// Saves the brief onto the contact, PRESERVING every other custom attribute.
export async function savePersonResearch(
  contactId: string,
  research: EntityResearch
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("attributes")
    .eq("id", contactId)
    .maybeSingle();
  const existing = (data && (data as any).attributes) || {};
  await supabaseAdmin
    .from("contacts")
    .update({ attributes: { ...existing, research } })
    .eq("id", contactId);
}

// ---------------------------------------------------------------------------
// The merged background - the single string the call screen and planner read
// ---------------------------------------------------------------------------

export function mergeBackground(
  company: EntityResearch | EntityState | null,
  person: EntityResearch | EntityState | null
): string {
  const parts: string[] = [];
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();

  const push = (label: string, r: any) => {
    if (!r || typeof r.background !== "string" || !r.background.trim()) return;
    const who = String(r.subject || "").trim();
    parts.push(`${label}${who ? `: ${who}` : ""}\n${r.background.trim()}`);
    for (const s of Array.isArray(r.sources) ? r.sources : []) {
      if (s && typeof s.url === "string" && s.url && !seen.has(s.url)) {
        seen.add(s.url);
        sources.push({ title: String(s.title || s.url), url: s.url });
      }
    }
  };

  // Person first: on a call, WHO you are talking to outranks the org they sit in.
  push("PERSON BRIEF", person);
  push("COMPANY BACKGROUND", company);

  if (!parts.length) return "";
  let out = parts.join("\n\n");
  if (sources.length) {
    out +=
      "\n\nSources:\n" +
      sources
        .slice(0, 12)
        .map((s) => `- ${s.title}: ${s.url}`)
        .join("\n");
  }
  return out;
}

export function mergedSources(
  company: any,
  person: any
): ResearchSource[] {
  const out: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const r of [person, company]) {
    for (const s of (r && Array.isArray(r.sources) ? r.sources : []) as any[]) {
      if (s && typeof s.url === "string" && s.url && !seen.has(s.url)) {
        seen.add(s.url);
        out.push({ title: String(s.title || s.url), url: s.url });
      }
    }
  }
  return out.slice(0, 12);
}

// Mirror both briefs onto the scheduled call, so the live call screen reloads
// them with no change to it (it reads research.background), and so the prep
// screen can show what is already known without re-reading two tables.
export async function mirrorOntoUpcoming(
  upcomingId: string,
  company: EntityResearch | null,
  person: EntityResearch | null
): Promise<string> {
  const { data } = await supabaseAdmin
    .from("upcoming_calls")
    .select("research")
    .eq("id", upcomingId)
    .maybeSingle();
  const prev = (data && (data as any).research) || {};

  const nextCompany = company || (prev as any).company || null;
  const nextPerson = person || (prev as any).person || null;
  const background = mergeBackground(nextCompany, nextPerson);

  await supabaseAdmin
    .from("upcoming_calls")
    .update({
      research: {
        company: nextCompany,
        person: nextPerson,
        background,
        sources: mergedSources(nextCompany, nextPerson),
        generatedAt: new Date().toISOString(),
      },
    })
    .eq("id", upcomingId);

  return background;
}

// House style used by every research prompt: no em dashes, no semicolons.
export function houseStyle(s: string): string {
  return String(s || "")
    .replace(/[\u2014\u2013]/g, ", ")
    .replace(/;/g, ",")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

// Pull the sources the model actually searched out of a tool-using response.
export function collectSources(blocks: any[]): ResearchSource[] {
  const out: ResearchSource[] = [];
  const seen = new Set<string>();
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b && b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (
          r &&
          r.type === "web_search_result" &&
          typeof r.url === "string" &&
          !seen.has(r.url)
        ) {
          seen.add(r.url);
          out.push({ title: String(r.title || r.url), url: r.url });
        }
      }
    }
  }
  return out.slice(0, 8);
}

export function textOf(blocks: any[]): string {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("")
    .trim();
}
