import { NextRequest, NextResponse } from "next/server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { normaliseCompanyName } from "@/lib/company-identity";
import { resolveExistingCompany } from "@/lib/company-resolver";
import { requireRequestScope } from "@/lib/request-scope";
import {
  activeSharedClientIds,
  loadSafeSharedCompanies,
} from "@/lib/team-client-sharing";
import { loadTeamLeadCoverCompanies } from "@/lib/team-lead-cover";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CompleteClientInput = {
  companyName: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  recordType: "prospect" | "relationship";
  relationshipStage: string;
};

const clean = (value: unknown, max: number) =>
  String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function blocker(
  status: number,
  input: Parameters<typeof crmBlockerPayload>[0]
) {
  return NextResponse.json(crmBlockerPayload(input), { status });
}

function parseInput(value: unknown): CompleteClientInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const input: CompleteClientInput = {
    companyName: clean(body.companyName, 200),
    firstName: clean(body.firstName, 120),
    lastName: clean(body.lastName, 120),
    email: clean(body.email, 320).toLowerCase(),
    jobTitle: clean(body.jobTitle, 200),
    recordType: body.recordType === "relationship" ? "relationship" : "prospect",
    relationshipStage: clean(body.relationshipStage, 80),
  };
  if (!input.companyName || !input.firstName || !EMAIL.test(input.email)) {
    return null;
  }
  return input;
}

async function exactAccessibleCompany(
  input: CompleteClientInput,
  scope: ReturnType<typeof requireRequestScope>
) {
  const exactName = normaliseCompanyName(input.companyName);
  const owned = await resolveExistingCompany(
    { name: input.companyName },
    { select: "id,name,stage,owner_id,workspace_id" }
  );
  const sharedIds = await activeSharedClientIds(
    scope.workspaceId,
    scope.role === "owner" ? undefined : scope.userId
  );
  const [sharedCompanies, coverCompanies] = await Promise.all([
    loadSafeSharedCompanies(sharedIds, scope.workspaceId),
    loadTeamLeadCoverCompanies(scope),
  ]);
  const candidates = [
    ...(owned ? [owned] : []),
    ...sharedCompanies,
    ...coverCompanies,
  ].filter((company) => normaliseCompanyName(company.name) === exactName);
  const unique = [
    ...new Map(candidates.map((company) => [company.id, company])).values(),
  ];
  if (unique.length > 1) {
    throw new Error("complete_client_company_ambiguous");
  }
  return unique[0] || null;
}

const ERROR_RESPONSES: Record<
  string,
  { status: number; payload: Parameters<typeof crmBlockerPayload>[0] }
> = {
  complete_client_auth_required: {
    status: 401,
    payload: {
      code: "complete_client_auth_required",
      title: "Sign-in required",
      reason: "LiveCoach could not verify the account creating this client",
      nextAction: "Refresh the page, sign in again and save the client once more",
      responsible: "user",
    },
  },
  complete_client_membership_required: {
    status: 403,
    payload: {
      code: "complete_client_membership_required",
      title: "CRM access blocked",
      reason: "This account is not an active member of the selected workspace",
      nextAction: "Ask a workspace owner to restore the account before adding clients",
      responsible: "owner",
    },
  },
  complete_client_existing_stage_conflict: {
    status: 409,
    payload: {
      code: "complete_client_existing_stage_conflict",
      title: "Existing relationship found",
      reason: "That company already exists as an established relationship, not a new prospect",
      nextAction: "Open the existing client and add or update its contact there",
      responsible: "user",
    },
  },
  complete_client_prospect_owned_elsewhere: {
    status: 409,
    payload: {
      code: "complete_client_prospect_owned_elsewhere",
      title: "Existing prospect belongs to another salesperson",
      reason: "That exact work email is already assigned to another active account",
      nextAction: "Ask a workspace owner to confirm the assignment instead of creating a duplicate",
      responsible: "owner",
    },
  },
  complete_client_contact_owned_elsewhere: {
    status: 409,
    payload: {
      code: "complete_client_contact_owned_elsewhere",
      title: "Existing CRM relationship found",
      reason: "That exact work email is already held in another teammate's private contact book",
      nextAction: "Ask a workspace owner to confirm the relationship owner instead of copying private data",
      responsible: "owner",
    },
  },
  complete_client_company_access_blocked: {
    status: 403,
    payload: {
      code: "complete_client_company_access_blocked",
      title: "Client access blocked",
      reason: "This company is private, confidential or not assigned to this account",
      nextAction: "Ask the record owner to share or assign the ordinary sales client first",
      responsible: "owner",
    },
  },
  complete_client_prospect_company_conflict: {
    status: 409,
    payload: {
      code: "complete_client_prospect_company_conflict",
      title: "Prospect company needs review",
      reason: "That exact email is already linked to a different CRM client",
      nextAction: "Open the existing prospect and correct its company before retrying",
      responsible: "user",
    },
  },
  complete_client_contact_company_conflict: {
    status: 409,
    payload: {
      code: "complete_client_contact_company_conflict",
      title: "Contact company needs review",
      reason: "That exact email is already saved against a different CRM client",
      nextAction: "Open the existing contact and correct its company before retrying",
      responsible: "user",
    },
  },
  complete_client_company_ambiguous: {
    status: 409,
    payload: {
      code: "complete_client_company_ambiguous",
      title: "Company needs review",
      reason: "More than one accessible CRM client has that exact company name",
      nextAction: "Open the correct existing client and add the contact from its profile",
      responsible: "user",
    },
  },
  complete_client_contact_ambiguous: {
    status: 409,
    payload: {
      code: "complete_client_contact_ambiguous",
      title: "Contact needs review",
      reason: "More than one of your contacts already uses that exact work email",
      nextAction: "Resolve the duplicate contacts before saving this client",
      responsible: "user",
    },
  },
};

export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const input = parseInput(await req.json().catch(() => null));
    if (!input) {
      return blocker(400, {
        code: "complete_client_details_required",
        title: "Client needs more information",
        reason: "Company name, contact first name and a valid exact work email are required",
        nextAction: "Complete those fields and save the client again",
        responsible: "user",
      });
    }

    const existingCompany = await exactAccessibleCompany(input, scope);
    // This RPC is not executable by browser sessions. The route binds the
    // verified middleware identity explicitly, then the transaction enforces
    // that exact active workspace member throughout every write.
    const { data, error } = await supabaseService.rpc(
      "create_complete_crm_client_server",
      {
        p_actor_id: scope.userId,
        p_workspace_id: scope.workspaceId,
        p_company_name: input.companyName,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_email: input.email,
        p_job_title: input.jobTitle,
        p_record_type: input.recordType,
        p_relationship_stage: input.relationshipStage,
        p_existing_company_id: existingCompany?.id || null,
      }
    );
    if (error) throw error;

    const result = data && typeof data === "object" ? data as Record<string, any> : null;
    if (
      !result?.company?.id ||
      !result?.contact?.id ||
      result.contact.company_id !== result.company.id ||
      String(result.contact.email || "").toLowerCase() !== input.email ||
      (input.recordType === "prospect" &&
        (!result?.prospect?.id || result.prospect.crm_company_id !== result.company.id))
    ) {
      throw new Error("complete_client_confirmation_missing");
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    const message = String(error?.message || "");
    const key = Object.keys(ERROR_RESPONSES).find((candidate) =>
      message.includes(candidate)
    );
    if (key) {
      const response = ERROR_RESPONSES[key];
      return blocker(response.status, response.payload);
    }
    if (/complete_client_(?:company|contact_name|email|job_title|record_type|stage)_invalid/.test(message)) {
      return blocker(400, {
        code: "complete_client_details_invalid",
        title: "Client details are not valid",
        reason: "One or more client or contact fields could not be validated safely",
        nextAction: "Review the company, contact, email and relationship details, then try again",
        responsible: "user",
      });
    }
    console.error("Complete client save failed", message || error);
    return blocker(500, {
      code: "complete_client_save_not_confirmed",
      title: "Client was not saved",
      reason: "LiveCoach could not confirm the company and primary contact together",
      nextAction: "Refresh the client list and try once more. If it repeats, send this blocker code to a workspace owner",
      responsible: "system",
    });
  }
}
