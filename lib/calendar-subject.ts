export type CalendarAttendee = {
  email?: string;
  displayName?: string;
  name?: string;
  self?: boolean;
  organizer?: boolean;
  responseStatus?: string;
};

export type PrimaryAttendeeMatch = {
  name: string;
  email: string;
  matchedBy:
    | "meeting_title"
    | "company_contact"
    | "company_domain"
    | "only_external_guest"
    | "only_guest";
};

export type PrimaryAttendeeContext = {
  title?: string | null;
  companyDomain?: string | null;
  contactEmails?: string[] | null;
  internalDomains?: string[] | Set<string> | null;
};

const DEFAULT_INTERNAL_DOMAINS = new Set(["ai13.com", "interviewa.com"]);

// These addresses may legitimately appear as supporting invitees on other
// client calls. They can identify the subject of a call only when the linked
// company is their own organisation, or when the linked record is explicitly
// marked as an internal company. This prevents a colleague or close partner
// from replacing the real lead just because they were the only accepted guest.
export const DEFAULT_PROTECTED_INTENT_DOMAINS = new Set([
  "ai13.com",
  "interviewa.com",
  "schoolofcoding.co.uk",
]);

const GENERIC_TITLE_WORDS = new Set([
  "a",
  "about",
  "and",
  "brainstorm",
  "brainstorming",
  "business",
  "call",
  "catch",
  "catchup",
  "chat",
  "check",
  "client",
  "conversation",
  "demo",
  "discovery",
  "discussion",
  "event",
  "for",
  "from",
  "in",
  "interview",
  "interviewa",
  "interviewer",
  "intro",
  "introduction",
  "livecoach",
  "meeting",
  "of",
  "on",
  "onsite",
  "planning",
  "product",
  "sales",
  "session",
  "sync",
  "the",
  "to",
  "training",
  "update",
  "video",
  "with",
  "workshop",
]);

const normalise = (value: unknown) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (value: unknown) => normalise(value).split(/\s+/).filter(Boolean);

export const calendarEmailDomain = (email: string) => {
  const match = String(email || "").toLowerCase().match(/@([^@\s]+)$/);
  return match ? match[1] : "";
};

const cleanDomain = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/:\d+$/, "");

export function calendarHasExternalGuest(
  attendees: CalendarAttendee[] | null | undefined,
  internalDomains: string[] | Set<string> = []
): boolean {
  const protectedDomains = new Set(DEFAULT_INTERNAL_DOMAINS);
  for (const domain of internalDomains || []) {
    const clean = cleanDomain(domain);
    if (clean) protectedDomains.add(clean);
  }
  return (attendees || []).some((attendee) => {
    if (!attendee?.email || attendee.self === true) return false;
    const domain = calendarEmailDomain(String(attendee.email));
    return Boolean(domain && !protectedDomains.has(domain));
  });
}

export type CompanyIntentEmailContext = {
  companyDomain?: string | null;
  companyInternal?: boolean;
  protectedDomains?: string[] | Set<string> | null;
};

export function emailMayInfluenceCompanyIntent(
  email: string,
  context: CompanyIntentEmailContext = {}
): boolean {
  const emailDomain = calendarEmailDomain(email);
  if (!emailDomain) return false;

  const protectedDomains = new Set(DEFAULT_PROTECTED_INTENT_DOMAINS);
  for (const domain of context.protectedDomains || []) {
    const clean = cleanDomain(domain);
    if (clean) protectedDomains.add(clean);
  }
  if (!protectedDomains.has(emailDomain)) return true;
  if (context.companyInternal === true) return true;

  const companyDomain = cleanDomain(context.companyDomain);
  return Boolean(companyDomain && companyDomain === emailDomain);
}

const nameFromEmail = (email: string) => {
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._+-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const attendeeName = (attendee: CalendarAttendee) => {
  const named = String(attendee.displayName || attendee.name || "").trim();
  return named || nameFromEmail(String(attendee.email || ""));
};

const unique = <T,>(rows: T[]) => (rows.length === 1 ? rows[0] : null);

// Calendar titles are often typed from memory while attendee names come from
// the address book. Accept one small spelling variation in a person token, for
// example "George" in the title and "Georgi" on the invite. Keep this narrow
// so a fuzzy company or short-name match cannot silently select the wrong guest.
const personTokenIsNearMatch = (left: string, right: string) => {
  if (left === right || left.length < 4 || right.length < 4) return false;
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits === 1;
};

const titleMatchScore = (
  attendee: CalendarAttendee,
  titleTokens: string[],
  compactTitle: string
) => {
  const email = String(attendee.email || "").toLowerCase().trim();
  const local = email.split("@")[0] || "";
  const localTokens = new Set(tokens(local));
  const domainTokens = new Set(
    tokens(calendarEmailDomain(email)).filter((token) => token.length >= 4)
  );
  const nameTokens = new Set(tokens(attendeeName(attendee)));
  const compactLocal = normalise(local).replace(/\s+/g, "");
  const compactName = normalise(attendeeName(attendee)).replace(/\s+/g, "");
  const compactEmail = normalise(email).replace(/\s+/g, "");
  let score = 0;

  // An address written in the event title is the clearest possible subject
  // signal. It must beat another attendee who merely happens to be a saved
  // contact, which is common when that attendee made the introduction.
  if (
    compactEmail.length >= 5 &&
    compactTitle.includes(compactEmail)
  ) {
    score += 100;
  }

  for (const titleToken of titleTokens) {
    if (nameTokens.has(titleToken)) score += 8;
    if (localTokens.has(titleToken)) score += 7;
    if (domainTokens.has(titleToken)) score += 6;
    if (
      titleToken.length >= 4 &&
      (compactName.startsWith(titleToken) || compactLocal.startsWith(titleToken))
    ) {
      score += 4;
    }
    if (
      [...nameTokens, ...localTokens].some((personToken) =>
        personTokenIsNearMatch(titleToken, personToken)
      )
    ) {
      score += 5;
    }
  }
  return score;
};

// Select the person the meeting is actually about. Calendar attendee ordering
// is not meaningful, so the resolver must never use "first invited person" as
// a tie breaker. A null result means the evidence is ambiguous and the caller
// should ask for a person rather than loading another invitee's CRM context.
export function pickPrimaryAttendee(
  attendees: CalendarAttendee[] | null | undefined,
  context: PrimaryAttendeeContext = {}
): PrimaryAttendeeMatch | null {
  const guests = (Array.isArray(attendees) ? attendees : [])
    .filter(
      (attendee) =>
        attendee &&
        attendee.self !== true &&
        typeof attendee.email === "string" &&
        attendee.email.trim()
    )
    .map((attendee) => ({
      ...attendee,
      email: String(attendee.email).toLowerCase().trim(),
    }));
  if (!guests.length) return null;

  const meaningfulTitleTokens = tokens(context.title).filter(
    (token) => token.length >= 3 && !GENERIC_TITLE_WORDS.has(token)
  );
  if (meaningfulTitleTokens.length) {
    const compactTitle = normalise(context.title).replace(/\s+/g, "");
    const scored = guests
      .map((attendee) => ({
        attendee,
        score: titleMatchScore(
          attendee,
          meaningfulTitleTokens,
          compactTitle
        ),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length) {
      const best = scored[0].score;
      const winners = scored.filter((row) => row.score === best);
      const winner = unique(winners);
      if (winner) {
        return {
          name: attendeeName(winner.attendee),
          email: String(winner.attendee.email),
          matchedBy: "meeting_title",
        };
      }
    }
  }

  const contactEmails = new Set(
    (context.contactEmails || [])
      .map((email) => String(email || "").toLowerCase().trim())
      .filter(Boolean)
  );
  const contact = unique(
    guests.filter((attendee) => contactEmails.has(String(attendee.email)))
  );
  if (contact) {
    return {
      name: attendeeName(contact),
      email: String(contact.email),
      matchedBy: "company_contact",
    };
  }

  const companyDomain = String(context.companyDomain || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (companyDomain) {
    const domainGuest = unique(
      guests.filter(
        (attendee) => calendarEmailDomain(String(attendee.email)) === companyDomain
      )
    );
    if (domainGuest) {
      return {
        name: attendeeName(domainGuest),
        email: String(domainGuest.email),
        matchedBy: "company_domain",
      };
    }
  }

  const internalDomains = new Set(DEFAULT_INTERNAL_DOMAINS);
  for (const domain of context.internalDomains || []) {
    const clean = String(domain || "").toLowerCase().trim();
    if (clean) internalDomains.add(clean);
  }
  const externalGuest = unique(
    guests.filter(
      (attendee) =>
        !internalDomains.has(calendarEmailDomain(String(attendee.email)))
    )
  );
  if (externalGuest) {
    return {
      name: attendeeName(externalGuest),
      email: String(externalGuest.email),
      matchedBy: "only_external_guest",
    };
  }

  const onlyGuest = unique(guests);
  if (onlyGuest) {
    return {
      name: attendeeName(onlyGuest),
      email: String(onlyGuest.email),
      matchedBy: "only_guest",
    };
  }

  return null;
}
