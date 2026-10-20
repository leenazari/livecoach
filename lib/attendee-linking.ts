import { pickPrimaryAttendee } from "./calendar-subject.ts";

const domainOf = (email: string) => {
  const match = String(email || "").toLowerCase().match(/@([^@\s]+)$/);
  return match ? match[1] : "";
};

const cleanDomain = (value: string) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/:\d+$/, "");

export type Attendee = {
  email?: string;
  displayName?: string;
  self?: boolean;
  organizer?: boolean;
  responseStatus?: string;
};

export type AttendeeConfig = {
  internalDomains: Set<string>;
  internalCompanyId: string | null;
  contactEmailToCompany: Map<string, string>;
  companyByDomain: Map<string, string>;
  ambiguousEmails?: Set<string>;
  ambiguousDomains?: Set<string>;
  companyById?: Map<string, ExistingCalendarCompany>;
};

export type ExistingCalendarCompany = {
  id: string;
  name?: string | null;
  domain?: string | null;
  profile?: Record<string, any> | null;
};

export type AttendeeEventContext = {
  title?: string | null;
};

export const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.co.uk", "live.com",
  "live.co.uk", "msn.com", "btinternet.com", "sky.com", "mail.com", "zoho.com",
  "fastmail.com", "yandex.com", "qq.com", "163.com",
]);

// Existing calendar links normally represent a deliberate human choice and
// must not be replaced. The sole safe repair is a known internal/test
// placeholder attached to a meeting whose guests all point at one different
// work domain, including a direct meeting with a protected partner. This fixes
// stale auto-links without touching a genuine client link or guessing between
// different outside organisations.
export function shouldRepairStaleCalendarCompanyLink(
  existing: ExistingCalendarCompany | null | undefined,
  attendees: Attendee[],
  config: AttendeeConfig
): boolean {
  if (!existing?.id) return false;
  const profile = existing.profile || {};
  const exclusionReason = String(
    (profile as any)?.pipeline_exclusion?.reason || ""
  ).toLowerCase();
  const domain = cleanDomain(String(existing.domain || ""));
  const internalPlaceholder =
    existing.id === config.internalCompanyId ||
    (profile as any)?.internal === true ||
    ((profile as any)?.pipeline_exclusion?.active === true &&
      exclusionReason.includes("internal"));
  const testPlaceholder =
    /^test(?:\s+client)?\b/i.test(String(existing.name || "").trim()) ||
    domain.endsWith(".example") ||
    (profile as any)?.test === true ||
    (profile as any)?.is_test === true;
  if (!internalPlaceholder && !testPlaceholder) return false;

  const outsideDomains = new Set(
    (attendees || [])
      .filter((attendee) => attendee?.email && !attendee.self)
      .map((attendee) => domainOf(String(attendee.email)))
      .filter(
        (attendeeDomain) =>
          attendeeDomain &&
          !config.internalDomains.has(attendeeDomain) &&
          !PERSONAL_DOMAINS.has(attendeeDomain)
      )
  );
  if (outsideDomains.size) {
    return outsideDomains.size === 1 && !outsideDomains.has(domain);
  }
  // Protected partner domains are excluded from OTHER clients' meetings, not
  // from direct meetings with that partner. Do not repair ambiguous mixed-
  // organisation meetings or infer a new partner record here.
  const guestDomains = new Set(
    (attendees || [])
      .filter((attendee) => attendee?.email && !attendee.self)
      .map((attendee) => domainOf(String(attendee.email)))
      .filter(Boolean)
  );
  const directCompany = inferLink(attendees, config).companyId;
  return guestDomains.size === 1 && !guestDomains.has(domain) &&
    Boolean(directCompany && directCompany !== existing.id);
}

function humanizeDomain(domain: string): string {
  const sld = (domain || "").split(".")[0] || domain;
  return sld
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function inferLink(
  attendees: Attendee[],
  config: AttendeeConfig,
  context: AttendeeEventContext = {}
): { companyId: string | null; isInternal: boolean } {
  const emails = (attendees || [])
    .filter((attendee) => attendee?.email && !attendee.self)
    .map((attendee) => String(attendee.email).toLowerCase().trim())
    .filter(Boolean);
  if (!emails.length) return { companyId: null, isInternal: false };

  const external = emails.filter(
    (email) => !config.internalDomains.has(domainOf(email))
  );
  if (!external.length) {
    // "Protected from influencing another client" does not mean "belongs to
    // our default internal company". Resolve a direct partner/internal meeting
    // by the actual person or one unambiguous guest organisation.
    const primary = pickPrimaryAttendee(attendees, {
      title: context.title,
      internalDomains: config.internalDomains,
    });
    if (primary) {
      if (config.ambiguousEmails?.has(primary.email)) return { companyId: null, isInternal: true };
      const companyId = config.contactEmailToCompany.get(primary.email) ||
        config.companyByDomain.get(domainOf(primary.email)) || null;
      return { companyId, isInternal: true };
    }
    const guestDomains = new Set(emails.map(domainOf));
    if (emails.some((email) => config.ambiguousEmails?.has(email))) return { companyId: null, isInternal: true };
    const matchedCompanies =
      emails.map((email) => config.contactEmailToCompany.get(email) ||
        config.companyByDomain.get(domainOf(email))).filter(Boolean);
    const companies = new Set(matchedCompanies);
    return {
      companyId: guestDomains.size === 1 && companies.size === 1 && matchedCompanies.length === emails.length
        ? Array.from(companies)[0] || null : null,
      isInternal: true,
    };
  }

  const primary = pickPrimaryAttendee(attendees, {
    title: context.title,
    internalDomains: config.internalDomains,
  });
  if (
    primary?.matchedBy === "meeting_title" &&
    !config.internalDomains.has(domainOf(primary.email))
  ) {
    if (config.ambiguousEmails?.has(primary.email)) return { companyId: null, isInternal: false };
    const exactCompany = config.contactEmailToCompany.get(primary.email);
    if (exactCompany) {
      return {
        companyId: exactCompany,
        isInternal: exactCompany === config.internalCompanyId,
      };
    }
    const domainCompany = config.companyByDomain.get(domainOf(primary.email));
    if (domainCompany) {
      return {
        companyId: domainCompany,
        isInternal: domainCompany === config.internalCompanyId,
      };
    }
    return { companyId: null, isInternal: false };
  }

  const externalDomains = new Set(external.map((email) => domainOf(email)));
  if (external.some((email) => config.ambiguousEmails?.has(email))) return { companyId: null, isInternal: false };
  const hits = new Set<string>();
  for (const email of external) {
    const companyId = config.contactEmailToCompany.get(email);
    if (companyId) hits.add(companyId);
  }
  if (hits.size === 1 && externalDomains.size === 1) {
    return { companyId: Array.from(hits)[0], isInternal: false };
  }
  return { companyId: null, isInternal: false };
}

export function deriveNewClientFromAttendees(
  attendees: Attendee[],
  config: AttendeeConfig,
  context: AttendeeEventContext = {}
): { domain: string; name: string; website: string; email: string } | null {
  const workAttendees = (attendees || [])
    .filter((attendee) => attendee?.email && !attendee.self)
    .map((attendee) => ({
      ...attendee,
      email: String(attendee.email).toLowerCase().trim(),
    }))
    .filter((attendee) => {
      const domain = domainOf(String(attendee.email));
      return (
        domain &&
        !config.internalDomains.has(domain) &&
        !PERSONAL_DOMAINS.has(domain)
      );
    });
  if (!workAttendees.length) return null;

  const domains = new Set(
    workAttendees.map((attendee) => domainOf(String(attendee.email)))
  );
  let email = "";
  if (domains.size === 1) {
    email = String(workAttendees[0].email);
  } else {
    const primary = pickPrimaryAttendee(workAttendees, {
      title: context.title,
      internalDomains: config.internalDomains,
    });
    if (!primary || primary.matchedBy !== "meeting_title") return null;
    email = primary.email;
  }

  const domain = domainOf(email);
  if (!domain || PERSONAL_DOMAINS.has(domain) || config.ambiguousDomains?.has(domain) ||
      workAttendees.some((attendee) => config.ambiguousEmails?.has(attendee.email))) return null;
  return {
    domain,
    name: humanizeDomain(domain),
    website: `https://${domain}`,
    email,
  };
}
