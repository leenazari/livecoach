export type OutreachCrmGuard = {
  eligibleCompanyIds: Set<string>;
  blockedCompanyIds: Set<string>;
  blockedDomains: Set<string>;
};

export function normalizeOutreachDomain(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      .hostname.replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return raw.replace(/^www\./, "").toLowerCase();
  }
}

export function crmCompanyAllowsColdOutreach(
  company: { id?: unknown; stage?: unknown },
  openOpportunityCompanyIds: Set<string>
): boolean {
  const companyId = String(company.id || "");
  const stage = String(company.stage || "").trim().toLowerCase();
  return stage === "new" && !!companyId && !openOpportunityCompanyIds.has(companyId);
}

export function prospectHasBlockedCrmRelationship(
  prospect: {
    crm_company_id?: unknown;
    company_domain?: unknown;
    website?: unknown;
    email?: unknown;
  },
  guard: OutreachCrmGuard
): boolean {
  const companyId = String(prospect.crm_company_id || "");
  const emailDomain = String(prospect.email || "").toLowerCase().split("@")[1] || "";
  const domain = normalizeOutreachDomain(
    prospect.company_domain || prospect.website || emailDomain
  );

  // A linked company must be positively confirmed as a New lead. Unknown,
  // dormant and engaged CRM records fail closed. A blocked duplicate domain
  // also wins over an otherwise eligible company link.
  if (companyId && !guard.eligibleCompanyIds.has(companyId)) return true;
  return !!(domain && guard.blockedDomains.has(domain));
}
