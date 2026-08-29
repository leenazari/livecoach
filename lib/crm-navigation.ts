export type ProspectNavigationTarget = {
  id?: unknown;
  crm_company_id?: unknown;
};

const routePart = (value: unknown) => {
  const text = String(value || "").trim();
  return text ? encodeURIComponent(text) : "";
};

export function crmCompanyHref(companyId: unknown): string | null {
  const id = routePart(companyId);
  return id ? `/crm/${id}` : null;
}

export function crmCallHref(callId: unknown): string | null {
  const id = routePart(callId);
  return id ? `/crm/calls/${id}` : null;
}

export function outreachProspectHref(
  prospect: ProspectNavigationTarget | null | undefined
): string | null {
  const companyHref = crmCompanyHref(prospect?.crm_company_id);
  if (companyHref) return companyHref;

  const prospectId = routePart(prospect?.id);
  return prospectId
    ? `/crm/outreach?tab=prospects&prospect=${prospectId}`
    : null;
}
