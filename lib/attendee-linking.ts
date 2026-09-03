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
  self?: boolean;
  organizer?: boolean;
  responseStatus?: string;
};

export type AttendeeConfig = {
  internalDomains: Set<string>;
  internalCompanyId: string | null;
  contactEmailToCompany: Map<string, string>;
  companyByDomain: Map<string, string>;
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

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.co.uk", "live.com",
  "live.co.uk", "msn.com", "btinternet.com", "sky.com", "mail.com", "zoho.com",
  "fastmail.com", "yandex.com", "qq.com", "163.com",
]);

// Existing calendar links normally represent a deliberate human choice and
// must not be replaced. The sole safe repair is a known internal/test
// placeholder attached to a meeting whose guests all point at one different
// external work domain. This fixes stale auto-links without touching a genuine
// client link or guessing between different outside organisations.
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
  return outsideDomains.size === 1 && !outsideDomains.has(domain);
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
    return { companyId: config.internalCompanyId, isInternal: true };
  }

  const primary = pickPrimaryAttendee(attendees, {
    title: context.title,
    internalDomains: config.internalDomains,
  });
  if (
    primary?.matchedBy === "meeting_title" &&
    !config.internalDomains.has(domainOf(primary.email))
  ) {
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

  const exactHits = new Set<string>();
  for (const email of emails) {
    const companyId = config.contactEmailToCompany.get(email);
    if (companyId) exactHits.add(companyId);
  }
  const externalDomains = new Set(external.map((email) => domainOf(email)));
  if (exactHits.size === 1 && externalDomains.size === 1) {
    const companyId = Array.from(exactHits)[0];
    if (companyId !== config.internalCompanyId) {
      return { companyId, isInternal: false };
    }
  }

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
  if (!domain || PERSONAL_DOMAINS.has(domain)) return null;
  return {
    domain,
    name: humanizeDomain(domain),
    website: `https://${domain}`,
    email,
  };
}
