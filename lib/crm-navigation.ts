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
  const prospectId = routePart(prospect?.id);
  if (prospectId)
    return `/crm/outreach?tab=prospects&prospect=${prospectId}`;

  // A linked CRM company can still be private to another workspace member.
  // Prospect links must therefore prefer the assigned outreach record and use
  // the company only as a fallback for legacy activity without a prospect ID.
  return crmCompanyHref(prospect?.crm_company_id);
}

export function outreachReplyHref(prospectId: unknown): string | null {
  const id = routePart(prospectId);
  return id ? `/crm/outreach?tab=replies&reply=${id}` : null;
}
