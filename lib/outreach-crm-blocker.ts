import { crmBlockerPayload, type CrmBlocker } from "@/lib/crm-blocker";
import {
  outreachCrmBlockReason,
  normalizeOutreachDomain,
  type OutreachCrmGuard,
} from "@/lib/outreach-crm-eligibility";

type ProspectIdentity = {
  company_name?: unknown;
  crm_company_id?: unknown;
  company_domain?: unknown;
  website?: unknown;
  email?: unknown;
};

export function outreachCrmBlocker(
  prospect: ProspectIdentity,
  guard: OutreachCrmGuard
): { status: number; error: string; blocker: CrmBlocker } | null {
  const reason = outreachCrmBlockReason(prospect, guard);
  if (!reason) return null;

  const companyName = String(prospect.company_name || "This company").trim();
  if (reason === "linked_company_unavailable") {
    return {
      status: 409,
      ...crmBlockerPayload({
        code: "outreach_company_access_required",
        title: "Outreach needs owner access",
        reason: `${companyName} is linked to this prospect, but its safe company details are not assigned to this salesperson`,
        nextAction:
          "Ask a workspace owner to assign the linked company to this salesperson, then try again",
        responsible: "owner",
      }),
    };
  }

  if (reason === "linked_company_ineligible") {
    return {
      status: 409,
      ...crmBlockerPayload({
        code: "outreach_existing_relationship_protected",
        title: "Existing CRM relationship protected",
        reason: `${companyName} is not confirmed as a New lead or already has an open opportunity`,
        nextAction:
          "Review the company stage and active opportunities before starting cold outreach",
        responsible: "manager",
      }),
    };
  }

  const emailDomain = String(prospect.email || "").toLowerCase().split("@")[1] || "";
  const domain = normalizeOutreachDomain(
    prospect.company_domain || prospect.website || emailDomain
  );
  return {
    status: 409,
    ...crmBlockerPayload({
      code: "outreach_company_domain_protected",
      title: "Existing company relationship protected",
      reason: domain
        ? `Another CRM relationship already uses ${domain}`
        : `${companyName} matches an existing CRM relationship`,
      nextAction:
        "Review the existing company relationship before starting another cold campaign",
      responsible: "manager",
    }),
  };
}
