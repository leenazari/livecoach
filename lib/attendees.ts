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
};

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
      supabaseAdmin.from("companies").select("id, profile"),
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

  return { internalDomains, internalCompanyId, contactEmailToCompany };
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
