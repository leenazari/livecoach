import type { CalendarAttendee, PrimaryAttendeeMatch } from "./calendar-subject";

type Call = { company_id?: string | null; prep?: any };
const email = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

// Only an email explicitly bound to this occurrence and client is authoritative.
// A company-wide rolling summary is not proof of this meeting's purpose.
export function verifiedCallEmail(call: Call) {
  const meta = call.prep?.intentMeta;
  const source = meta?.emailSource;
  const context = call.prep?.focusBasisEmailContext;
  if (meta?.source !== "manual" || !call.company_id ||
      source?.companyId !== call.company_id || !email(meta.leadEmail) ||
      !["gmail", "microsoft"].includes(source.provider) ||
      typeof source.threadId !== "string" || !source.threadId.trim() ||
      typeof source.subject !== "string" || !source.subject.trim() ||
      typeof context !== "string" || !context.trim()) return null;
  return {
    email: email(meta.leadEmail), subject: source.subject.trim(),
    context: context.trim(), updatedAt: typeof meta.savedAt === "string" ? meta.savedAt : null,
  };
}

export function resolveCallLeadContext(
  call: Call,
  eligible: CalendarAttendee[],
  calendarPrimary: PrimaryAttendeeMatch | null,
  contacts: { email?: string | null; name?: string | null }[] = [],
) {
  const choices = [...new Map(eligible.filter(a => !a.self && email(a.email))
    .map(a => {
      const address = email(a.email);
      const contact = contacts.find(c => email(c.email) === address);
      return [address, { email: address, name: contact?.name?.trim() || a.displayName || a.name || address }] as const;
    })).values()];
  const selection = call.prep?.leadSelection;
  const source = verifiedCallEmail(call);
  // Never silently replace a saved choice after an invite or client changes.
  const selectedEmail = selection ? email(selection.email) : source?.email;
  const selected = choices.find(c => c.email === selectedEmail);
  const validSelection = !selection || (selection.source === "manual" && selection.companyId === (call.company_id || null));
  const primaryAttendee: PrimaryAttendeeMatch | null = selectedEmail || selection
    ? validSelection && selected
      ? { ...selected, matchedBy: selection ? "manual_selection" : "verified_email" }
      : null
    : calendarPrimary;
  return {
    primaryAttendee,
    leadChoices: choices,
    needsLeadConfirmation: !primaryAttendee,
    meetingEmail: source && source.email === primaryAttendee?.email ? source : null,
  };
}

// A stale tab cannot drop or forge server-validated lead/source metadata while
// autosaving a focus plan. These fields are changed only by the lead endpoint.
export function preserveCallLeadMetadata(current: any, incoming: any) {
  const result = { ...(incoming && typeof incoming === "object" ? incoming : {}) };
  delete result.leadSelection;
  delete result.intentMeta;
  if (current?.leadSelection) result.leadSelection = current.leadSelection;
  if (current?.intentMeta) result.intentMeta = current.intentMeta;
  if (current?.intentMeta?.emailSource) result.focusBasisEmailContext = current.focusBasisEmailContext;
  return result;
}
