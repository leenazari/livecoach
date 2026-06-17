import { supabaseAdmin } from "@/lib/supabase";

// Infer WHO a calendar event is with from its guest list, not from the note.
// The invitees are the ground truth: an all-internal guest list (your own team's
// domains) is an internal board/strategy call; an outside guest matched to a
// client's contact is a call with that client. Names merely mentioned in the
// note are the topic, never the participant. Conservative: returns no client
// when it can't tell, so the call stays unassigned rather than mis-filed.

const domainOf = (email: string) => {
  const m = String(email || "").toLowerCase().match(/@([^@\s]+)$/);
  return m ? m[1] : "";
};

export type Attendee = {
  email?: string;
  self?: boolean;
  organizer?: boolean;
  responseStatus?: string;
};

export type AttendeeConfig = {
  internalDomains: Set<string>;
  internalCompanyId: string | null;
  contactEmailToCompany: Map<string, string>;
  companyByDomain: Map<string, string>;
};

// Free / personal email providers - a guest on one of these gives us no company
// to create, so we never auto-create a client from them.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.co.uk", "live.com",
  "live.co.uk", "msn.com", "btinternet.com", "sky.com", "mail.com", "zoho.com",
  "fastmail.com", "yandex.com", "qq.com", "163.com",
]);

// "acme-corp.co.uk" -> "Acme Corp": the second-level label, words title-cased.
function humanizeDomain(domain: string): string {
  const sld = (domain || "").split(".")[0] || domain;
  return sld
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Load the config once per sync (internal domains, the designated internal
// entity, and the client contact-email index), so per-event inference is cheap.
export async function loadAttendeeConfig(): Promise<AttendeeConfig> {
  const [{ data: prof }, { data: companies }, { data: contacts }] =
    await Promise.all([
      supabaseAdmin
        .from("workspace_profile")
        .select("internal_domains")
        .eq("id", "main")
        .maybeSingle(),
      supabaseAdmin.from("companies").select("id, profile, domain"),
      supabaseAdmin
        .from("contacts")
        .select("company_id, email")
        .not("company_id", "is", null)
        .not("email", "is", null),
    ]);

  const domainsRaw: any[] = Array.isArray((prof as any)?.internal_domains)
    ? (prof as any).internal_domains
    : [];
  const internalDomains = new Set<string>(
    domainsRaw.map((d: any) => String(d || "").toLowerCase().trim())
  );

  const internalCompanyId =
    ((companies || []).find(
      (c: any) => c.profile && (c.profile as any).internal === true
    )?.id as string) || null;

  const contactEmailToCompany = new Map<string, string>();
  for (const c of contacts || []) {
    const e = String((c as any).email || "").toLowerCase().trim();
    if (e) contactEmailToCompany.set(e, (c as any).company_id as string);
  }

  const companyByDomain = new Map<string, string>();
  for (const c of companies || []) {
    const d = String((c as any).domain || "").toLowerCase().trim();
    if (d) companyByDomain.set(d, (c as any).id as string);
  }

  return {
    internalDomains,
    internalCompanyId,
    contactEmailToCompany,
    companyByDomain,
  };
}

// Pure inference from an event's attendees + the preloaded config.
export function inferLink(
  attendees: Attendee[],
  config: AttendeeConfig
): { companyId: string | null; isInternal: boolean } {
  const emails = (attendees || [])
    .filter((a) => a && a.email && !a.self)
    .map((a) => String(a.email).toLowerCase().trim())
    .filter(Boolean);
  if (!emails.length) return { companyId: null, isInternal: false };

  const external = emails.filter(
    (e) => !config.internalDomains.has(domainOf(e))
  );

  // Everyone (besides you) is on your own team's domains -> internal call.
  if (external.length === 0) {
    return { companyId: config.internalCompanyId, isInternal: true };
  }

  // Otherwise, an outside guest matched to a client's contact wins, but only if
  // they all point to the SAME client (no guessing between two).
  const hits = new Set<string>();
  for (const e of external) {
    const cid = config.contactEmailToCompany.get(e);
    if (cid) hits.add(cid);
  }
  if (hits.size === 1) {
    return { companyId: Array.from(hits)[0], isInternal: false };
  }
  return { companyId: null, isInternal: false };
}

// When the guest list is all we have and no client matched, derive a brand-new
// client from the guest's WORK email: company name and website straight from the
// domain, so the relationship is captured from the first invite. Only fires for
// a single external work domain (never a personal inbox, never ambiguous).
export function deriveNewClientFromAttendees(
  attendees: Attendee[],
  config: AttendeeConfig
): { domain: string; name: string; website: string; email: string } | null {
  const work = (attendees || [])
    .filter((a) => a && a.email && !a.self)
    .map((a) => String(a.email).toLowerCase().trim())
    .filter(Boolean)
    .filter((e) => {
      const d = domainOf(e);
      return (
        d && !config.internalDomains.has(d) && !PERSONAL_DOMAINS.has(d)
      );
    });
  if (!work.length) return null;

  const domains = new Set(work.map((e) => domainOf(e)));
  if (domains.size !== 1) return null; // more than one outside company, don't guess

  const domain = Array.from(domains)[0];
  const email = work.find((e) => domainOf(e) === domain) || work[0];
  return {
    domain,
    name: humanizeDomain(domain),
    website: `https://${domain}`,
    email,
  };
}
