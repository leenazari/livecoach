import "server-only";

import { normaliseCompanyDomain } from "@/lib/company-identity";
import {
  DEFAULT_PROTECTED_INTENT_DOMAINS,
  emailMayInfluenceCompanyIntent,
  pickPrimaryAttendee,
  type CalendarAttendee,
  type PrimaryAttendeeMatch,
} from "@/lib/calendar-subject";
import { supabaseAdmin } from "@/lib/supabase";
import { ensureWorkspaceProfileId } from "@/lib/workspace-profile";

export type UpcomingCallSubjectRecord = {
  id: string;
  company_id?: string | null;
  title?: string | null;
  attendees?: CalendarAttendee[] | null;
};

const FALLBACK_INTERNAL_DOMAINS = [
  ...DEFAULT_PROTECTED_INTENT_DOMAINS,
];

export async function loadProtectedIntentDomains(): Promise<string[]> {
  const profileId = await ensureWorkspaceProfileId();
  const { data: profile, error } = await supabaseAdmin
    .from("workspace_profile")
    .select("internal_domains")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  return [
    ...FALLBACK_INTERNAL_DOMAINS,
    ...(Array.isArray((profile as any)?.internal_domains)
      ? (profile as any).internal_domains
      : []),
  ];
}

export async function resolvePrimaryAttendeeForCall(
  call: UpcomingCallSubjectRecord
): Promise<PrimaryAttendeeMatch | null> {
  const profileId = await ensureWorkspaceProfileId();
  const companyId = String(call.company_id || "").trim();
  const [{ data: profile, error: profileError }, companyResult, contactsResult] =
    await Promise.all([
      supabaseAdmin
        .from("workspace_profile")
        .select("internal_domains")
        .eq("id", profileId)
        .maybeSingle(),
      companyId
        ? supabaseAdmin
            .from("companies")
            .select("name,domain,website,profile")
            .eq("id", companyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      companyId
        ? supabaseAdmin
            .from("contacts")
            .select("name,email")
            .eq("company_id", companyId)
            .not("email", "is", null)
            .limit(50)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (profileError) throw profileError;
  if (companyResult.error) throw companyResult.error;
  if (contactsResult.error) throw contactsResult.error;

  const contacts = contactsResult.data || [];
  const internalDomains = [
    ...FALLBACK_INTERNAL_DOMAINS,
    ...(Array.isArray((profile as any)?.internal_domains)
      ? (profile as any).internal_domains
      : []),
  ];
  const companyDomain = normaliseCompanyDomain(
    (companyResult.data as any)?.domain || (companyResult.data as any)?.website
  );
  const companyInternal =
    (companyResult.data as any)?.profile?.internal === true;
  // When a call is already linked to a client, protected supporting attendees
  // are not eligible lead candidates unless this is their own company or an
  // explicit internal record. The real lead can still win by name, contact or
  // company domain, regardless of calendar ordering or RSVP status.
  const eligibleAttendees = companyResult.data
    ? (call.attendees || []).filter(
        (attendee) =>
          attendee?.self === true ||
          !attendee?.email ||
          emailMayInfluenceCompanyIntent(attendee.email, {
            companyDomain,
            companyInternal,
            protectedDomains: internalDomains,
          })
      )
    : call.attendees;
  const primary = pickPrimaryAttendee(eligibleAttendees, {
    title: call.title,
    companyDomain,
    contactEmails: contacts.map((contact: any) => contact.email),
    internalDomains,
  });
  if (!primary) return null;

  const savedContact = contacts.find(
    (contact: any) =>
      String(contact.email || "").toLowerCase().trim() === primary.email
  );
  return savedContact?.name
    ? { ...primary, name: String(savedContact.name).trim() }
    : primary;
}

export async function loadPrimaryAttendeeForUpcoming(upcomingId: string) {
  const { data: call, error } = await supabaseAdmin
    .from("upcoming_calls")
    .select("id,company_id,title,attendees")
    .eq("id", upcomingId)
    .maybeSingle();
  if (error) throw error;
  if (!call) return { call: null, primaryAttendee: null };
  return {
    call,
    primaryAttendee: await resolvePrimaryAttendeeForCall(call),
  };
}
