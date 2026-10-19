import { emailMayInfluenceCompanyIntent, pickPrimaryAttendee } from "./calendar-subject.ts";
import type { Attendee, AttendeeConfig } from "./attendee-linking.ts";

type PriorCall = {
  title?: string | null;
  company_id?: string | null;
  attendees?: Attendee[] | null;
};

const guestKey = (attendees: Attendee[] | null | undefined) =>
  [...new Set((attendees || [])
    .filter((person) => person?.email && !person.self)
    .map((person) => String(person.email).trim().toLowerCase()))].sort().join("|");

// A generic event title is not an identity. Preserve recurring curation only
// when the complete non-self guest list agrees, and all such history points at
// one accessible company. Empty or conflicting evidence needs human review.
export function inheritVerifiedCalendarCompany(
  event: { title: string; attendees: Attendee[] },
  priors: PriorCall[],
  accessibleCompanyIds: Set<string>
): string | null {
  const key = guestKey(event.attendees);
  if (!key) return null;
  const candidates = new Set(priors
    .filter((prior) => prior.title === event.title && guestKey(prior.attendees) === key)
    .map((prior) => prior.company_id)
    .filter((id): id is string => Boolean(id && accessibleCompanyIds.has(id))));
  return candidates.size === 1 ? [...candidates][0] : null;
}

// A company-wide next-call cache may concern a different person. Only reuse a
// lead-bound intent after resolving this event's attendee against that company.
export function cachedIntentForCalendarAttendee(
  event: { title: string; attendees: Attendee[] },
  companyId: string,
  config: AttendeeConfig,
  cached: { intent?: unknown; basedOnLeadEmail?: unknown } | null | undefined
): string | null {
  const company = config.companyById?.get(companyId);
  if (!company || typeof cached?.intent !== "string" || !cached.intent.trim()) return null;
  const primary = pickPrimaryAttendee(event.attendees, {
    title: event.title,
    internalDomains: config.internalDomains,
    companyDomain: company.domain,
    contactEmails: [...config.contactEmailToCompany]
      .filter(([, id]) => id === companyId).map(([email]) => email),
  });
  if (!primary || config.ambiguousEmails?.has(primary.email) || !emailMayInfluenceCompanyIntent(primary.email, {
    companyDomain: company.domain,
    protectedDomains: config.internalDomains,
  })) return null;
  const cachedLead = String(cached.basedOnLeadEmail || "").trim().toLowerCase();
  return cachedLead === primary.email ? cached.intent.trim() : null;
}
