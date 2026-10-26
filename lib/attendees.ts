import { supabaseAdmin } from "@/lib/supabase";
import { ensureWorkspaceProfileId } from "@/lib/workspace-profile";
import type { AttendeeConfig } from "@/lib/attendee-linking";
import { loadOwnAccountEmails } from "@/lib/own-account-emails";

export {
  deriveNewClientFromAttendees,
  inferLink,
  shouldRepairStaleCalendarCompanyLink,
} from "@/lib/attendee-linking";
export type {
  Attendee,
  AttendeeConfig,
  AttendeeEventContext,
  ExistingCalendarCompany,
} from "@/lib/attendee-linking";

// Load the config once per sync. Every query uses the signed-in request scope,
// so contact and company identities cannot cross accounts or workspaces.
export async function loadAttendeeConfig(): Promise<AttendeeConfig> {
  const selfEmails = await loadOwnAccountEmails();
  const profileId = await ensureWorkspaceProfileId();
  const [{ data: profile, error: profileError }, { data: companies, error: companiesError }, { data: contacts, error: contactsError }] =
    await Promise.all([
      supabaseAdmin
        .from("workspace_profile")
        .select("internal_domains")
        .eq("id", profileId)
        .maybeSingle(),
      supabaseAdmin.from("companies").select("id, name, profile, domain"),
      supabaseAdmin
        .from("contacts")
        .select("company_id, email")
        .not("company_id", "is", null)
        .not("email", "is", null),
    ]);
  if (profileError) throw profileError;
  if (companiesError) throw companiesError;
  if (contactsError) throw contactsError;

  const configuredDomains: any[] = Array.isArray(
    (profile as any)?.internal_domains
  )
    ? (profile as any).internal_domains
    : [];
  const internalDomains = new Set<string>([
    "ai13.com",
    "interviewa.com",
    "schoolofcoding.co.uk",
    ...configuredDomains.map((domain: any) =>
      String(domain || "").toLowerCase().trim()
    ),
  ]);

  const internalCompanyId =
    ((companies || []).find(
      (company: any) => company.profile?.internal === true
    )?.id as string) || null;

  const contactEmailToCompany = new Map<string, string>();
  const ambiguousEmails = new Set<string>();
  for (const contact of contacts || []) {
    const email = String((contact as any).email || "").toLowerCase().trim();
    if (email) {
      const companyId = (contact as any).company_id as string;
      const existing = contactEmailToCompany.get(email);
      if (existing && existing !== companyId) ambiguousEmails.add(email);
      contactEmailToCompany.set(email, companyId);
    }
  }
  for (const email of ambiguousEmails) contactEmailToCompany.delete(email);

  const companyByDomain = new Map<string, string>();
  const ambiguousDomains = new Set<string>();
  const companyById = new Map<string, any>();
  for (const company of companies || []) {
    const domain = String((company as any).domain || "").toLowerCase().trim();
    if (domain) {
      const existing = companyByDomain.get(domain);
      if (existing && existing !== company.id) ambiguousDomains.add(domain);
      companyByDomain.set(domain, company.id);
    }
    companyById.set(String((company as any).id), company as any);
  }
  for (const domain of ambiguousDomains) companyByDomain.delete(domain);

  return {
    selfEmails,
    internalDomains,
    internalCompanyId,
    contactEmailToCompany,
    companyByDomain,
    ambiguousEmails,
    ambiguousDomains,
    companyById,
  };
}
