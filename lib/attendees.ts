import { supabaseAdmin } from "@/lib/supabase";
import { ensureWorkspaceProfileId } from "@/lib/workspace-profile";
import type { AttendeeConfig } from "@/lib/attendee-linking";

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
  const profileId = await ensureWorkspaceProfileId();
  const [{ data: profile }, { data: companies }, { data: contacts }] =
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
  for (const contact of contacts || []) {
    const email = String((contact as any).email || "").toLowerCase().trim();
    if (email) {
      contactEmailToCompany.set(email, (contact as any).company_id as string);
    }
  }

  const companyByDomain = new Map<string, string>();
  const companyById = new Map<string, any>();
  for (const company of companies || []) {
    const domain = String((company as any).domain || "").toLowerCase().trim();
    if (domain) companyByDomain.set(domain, (company as any).id as string);
    companyById.set(String((company as any).id), company as any);
  }

  return {
    internalDomains,
    internalCompanyId,
    contactEmailToCompany,
    companyByDomain,
    companyById,
  };
}
