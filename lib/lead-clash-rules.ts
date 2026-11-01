// Pure lead-clash rules. Safe to import from client components and tests.
// The database function is the privacy boundary; these helpers keep the
// application copy, the kill switch and the duplicate report aligned with it.

export const FREE_MAIL_DOMAINS = [
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.co.uk",
  "hotmail.com",
  "icloud.com",
  "live.co.uk",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.co.uk",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.co.uk",
  "yahoo.com",
] as const;

export const INTERNAL_DOMAINS = ["ai13.com", "interviewa.com"] as const;

const FREE_MAIL = new Set<string>(FREE_MAIL_DOMAINS);
const INTERNAL = new Set<string>(INTERNAL_DOMAINS);

export type LeadClashMatchType = "person" | "domain" | "name";
export type LeadClashDisposition = "clash" | "shared";

export type LeadClashMatch = {
  otherUserId: string;
  otherDisplayName: string;
  companyName: string | null;
  contactLabel: string | null;
  lastTouchAt: string | null;
  lastTouchKind: string | null;
  nextTouchAt: string | null;
  matchType: LeadClashMatchType;
  matchValue: string | null;
  otherCompanyId: string | null;
  confidential: boolean;
  disposition: LeadClashDisposition;
};

export type LeadClashWarning = {
  canProceed: boolean;
  matches: LeadClashMatch[];
};

const truthy = (value: unknown) =>
  ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());

const falsy = (value: unknown) =>
  ["0", "false", "no", "off"].includes(String(value ?? "").trim().toLowerCase());

// The database row is the only way to turn checks on. Environment values can
// only force them off, so a running deployment can be stopped from the
// workspace setting without waiting for a new release.
export function leadClashSwitchEnabled(input: {
  forceOff?: string | null;
  enabledEnv?: string | null;
  databaseEnabled?: boolean | null;
  databaseReadable?: boolean;
}): boolean {
  if (truthy(input.forceOff)) return false;
  if (falsy(input.enabledEnv)) return false;
  if (input.databaseReadable === false) return false;
  return input.databaseEnabled === true;
}

export function normaliseMatchDomain(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

export function isExcludedMatchDomain(value: unknown): boolean {
  const domain = normaliseMatchDomain(value);
  if (!domain || !domain.includes(".")) return true;
  return FREE_MAIL.has(domain) || INTERNAL.has(domain);
}

export function emailDomain(value: unknown): string {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "";
  return normaliseMatchDomain(email.slice(at + 1));
}

export function companyNameKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|incorporated|inc|llc|plc|company|co)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "");
}

export function possibleCompanyNameKey(value: unknown): string {
  const loosened = String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|incorporated|inc|llc|plc|company|co|group|uk)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return loosened.replace(/ /g, "");
}

export function linkedinSlug(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return "";
    const match = url.pathname.match(/\/in\/([^/?#]+)/i);
    return (match?.[1] || "").toLowerCase();
  } catch {
    const match = raw.toLowerCase().match(/linkedin\.com\/in\/([^/?#]+)/);
    return match?.[1] || "";
  }
}

export function contactLabel(value: unknown): string | null {
  const parts = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0].slice(0, 40);
  const initial = parts[parts.length - 1].charAt(0).toUpperCase();
  if (!initial) return parts[0].slice(0, 40);
  return `${parts[0].slice(0, 40)} ${initial}.`;
}

export function isExcludedLeadClashCompany(company: {
  name?: string | null;
  profile?: Record<string, unknown> | null;
}): boolean {
  const name = String(company.name || "").trim();
  if (/^(test|internal)([\s-]|$)/i.test(name)) return true;
  const flag = company.profile?.lead_clash_exclude;
  return flag === true || ["true", "1", "yes"].includes(String(flag || "").toLowerCase());
}

export function formatTouchDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}

export function actionableClashes(matches: LeadClashMatch[]): LeadClashMatch[] {
  return matches.filter((match) => match.disposition === "clash");
}

export function strongClashes(matches: LeadClashMatch[]): LeadClashMatch[] {
  return matches.filter(
    (match) =>
      match.disposition === "clash" &&
      (match.matchType === "person" || match.matchType === "domain")
  );
}

export function clashSummary(match: LeadClashMatch): string {
  if (match.confidential || !match.companyName) {
    return "A colleague is working this account.";
  }
  const who = match.otherDisplayName || "A teammate";
  const contact = match.contactLabel ? ` Contact: ${match.contactLabel}.` : "";
  const last = formatTouchDate(match.lastTouchAt);
  const next = formatTouchDate(match.nextTouchAt);
  const touches = [
    last ? `Last touch: ${last}.` : "",
    next ? `Next touch: ${next}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (match.matchType === "name") {
    return `${who} has a similarly named company, ${match.companyName}.${contact} ${touches}`.trim();
  }
  return `${who} is working ${match.companyName}.${contact} ${touches}`.trim();
}

export function clashWarningCopy(matches: LeadClashMatch[]): {
  title: string;
  reason: string;
  nextAction: string;
} {
  const clashes = actionableClashes(matches);
  const first = clashes[0];
  const extra = clashes.length > 1 ? ` ${clashes.length - 1} other match${clashes.length === 2 ? "" : "es"} also need a look.` : "";
  const soft = first?.matchType === "name";
  return {
    title: soft
      ? "Possible lead clash"
      : "Another rep may already be working this lead",
    reason: first
      ? `${clashSummary(first)}${extra}`.replace(/\s+/g, " ").trim()
      : "Another rep may already be working this lead.",
    nextAction: soft
      ? "Continue only if this is a different organisation, and add a short reason. Nothing has been saved yet."
      : "Continue only if this is a different lead, and add a short reason. Otherwise ask a workspace owner before creating another copy. Nothing has been saved yet.",
  };
}

export function sharesCalendarEvent(input: {
  attendeeEmails?: string[] | null;
  otherEmails?: string[] | null;
  externalIds?: string[] | null;
  otherExternalIds?: string[] | null;
  meetingUrls?: string[] | null;
  otherMeetingUrls?: string[] | null;
}): boolean {
  const normal = (value: string) => value.trim().toLowerCase();
  const others = new Set((input.otherEmails || []).map(normal).filter(Boolean));
  if ((input.attendeeEmails || []).some((email) => others.has(normal(email)))) return true;
  const otherEvents = new Set((input.otherExternalIds || []).map(normal).filter(Boolean));
  if ((input.externalIds || []).some((id) => otherEvents.has(normal(id)))) return true;
  const otherUrls = new Set(
    (input.otherMeetingUrls || []).map((url) => normal(url).replace(/[?#].*$/, "")).filter(Boolean)
  );
  return (input.meetingUrls || []).some((url) =>
    otherUrls.has(normal(url).replace(/[?#].*$/, ""))
  );
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

// Pages are ordered by the caller. One thousand rows is a transport page,
// not a silent cutoff: the caller keeps asking until a short page comes back.
export async function collectPages<T>(
  load: (
    from: number,
    to: number
  ) => Promise<{ data: T[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  return rows;
}

export function prepareCompaniesForDuplicateScan<T extends {
  id: string;
  name: string;
  domain?: string | null;
  website?: string | null;
  profile?: Record<string, unknown> | null;
}>(
  companies: T[],
  options: { excludeGenericDomains?: boolean; excludeTestRecords?: boolean } = {}
): T[] {
  return companies.flatMap((company) => {
    if (options.excludeTestRecords && isExcludedLeadClashCompany(company)) return [];
    if (!options.excludeGenericDomains) return [company];
    const domain = normaliseMatchDomain(company.domain || company.website);
    if (!domain || !isExcludedMatchDomain(domain)) return [company];
    return [{ ...company, domain: null, website: null }];
  });
}

export function prepareContactsForDuplicateScan<T extends { email?: string | null }>(
  contacts: T[],
  options: { excludeInternalEmails?: boolean } = {}
): T[] {
  if (!options.excludeInternalEmails) return contacts;
  return contacts.map((contact) => {
    const domain = emailDomain(contact.email);
    if (domain && INTERNAL.has(domain)) return { ...contact, email: null };
    return contact;
  });
}

export function parseLeadClashMatches(value: unknown): LeadClashMatch[] {
  if (!Array.isArray(value)) return [];
  const matches: LeadClashMatch[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const matchType = String(record.match_type || record.matchType || "");
    const disposition = String(record.disposition || "");
    if (matchType !== "person" && matchType !== "domain" && matchType !== "name") continue;
    if (disposition !== "clash" && disposition !== "shared") continue;
    const otherUserId = String(record.other_user_id || record.otherUserId || "");
    if (!/^[0-9a-f-]{36}$/i.test(otherUserId)) continue;
    const confidential = record.confidential === true;
    matches.push({
      otherUserId,
      otherDisplayName: confidential
        ? "A colleague"
        : String(record.other_display_name || record.otherDisplayName || "A teammate").slice(0, 80),
      companyName: confidential
        ? null
        : textOrNull(record.company_name ?? record.companyName, 160),
      contactLabel: confidential
        ? null
        : textOrNull(record.contact_label ?? record.contactLabel, 48),
      lastTouchAt: confidential
        ? null
        : textOrNull(record.last_touch_at ?? record.lastTouchAt, 40),
      lastTouchKind: confidential
        ? null
        : textOrNull(record.last_touch_kind ?? record.lastTouchKind, 40),
      nextTouchAt: confidential
        ? null
        : textOrNull(record.next_touch_at ?? record.nextTouchAt, 40),
      matchType,
      matchValue: confidential
        ? null
        : textOrNull(record.match_value ?? record.matchValue, 120),
      otherCompanyId: textOrNull(record.other_company_id ?? record.otherCompanyId, 36),
      confidential,
      disposition,
    });
  }
  return matches.slice(0, 5);
}

function textOrNull(value: unknown, maximum: number): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maximum) : null;
}
