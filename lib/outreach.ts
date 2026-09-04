import { getServiceRecordScope } from "@/lib/service-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { getRequestScope, isVerifiedServiceRequest } from "@/lib/request-scope";
import { loadSafeSharedCompanies } from "@/lib/team-client-sharing";
import {
  crmCompanyAllowsColdOutreach,
  normalizeOutreachDomain,
  type OutreachCrmGuard,
} from "@/lib/outreach-crm-eligibility";

export {
  outreachCrmBlockReason,
  prospectHasBlockedCrmRelationship,
  type OutreachCrmBlockReason,
  type OutreachCrmGuard,
} from "@/lib/outreach-crm-eligibility";
export {
  OUTREACH_DAILY_HARD_LIMIT,
  OUTREACH_DEFAULT_DAILY_LIMIT,
  clampOutreachDailyLimit,
} from "@/lib/outreach-limits";

export const OUTREACH_TIME_ZONE = "Europe/London";

export function londonDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OUTREACH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function londonDayBounds(date = new Date()): { start: string; end: string } {
  const day = londonDate(date);
  const midday = new Date(`${day}T12:00:00Z`);
  const offsetName = new Intl.DateTimeFormat("en-GB", {
    timeZone: OUTREACH_TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(midday).find((part) => part.type === "timeZoneName")?.value || "GMT+00:00";
  const offset = offsetName.replace("GMT", "") || "+00:00";
  const start = new Date(`${day}T00:00:00${offset}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function emailDomain(email: string): string {
  return String(email || "").toLowerCase().split("@")[1] || "";
}

export function modelText(message: any): string {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();
}

export function parseObject(text: string): Record<string, any> | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    return null;
  }
}

export function modelSources(message: any): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const part of Array.isArray(message?.content) ? message.content : []) {
    if (part?.type !== "web_search_tool_result" || !Array.isArray(part.content)) continue;
    for (const result of part.content) {
      const url = typeof result?.url === "string" ? result.url : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ title: String(result.title || url), url });
    }
  }
  return out.slice(0, 8);
}

const CRM_GUARD_PAGE_SIZE = 500;

async function loadAssignedSharedCompaniesForOutreach(): Promise<any[]> {
  const requestScope = getRequestScope();
  const serviceScope =
    !requestScope && isVerifiedServiceRequest()
      ? getServiceRecordScope()
      : null;
  const scope = requestScope || serviceScope;
  if (!scope) return [];

  // The verified sender may use only the safe projection of companies which
  // the owner explicitly assigned to them. The private source row, notes,
  // emails and commercial memory are never loaded into outreach.
  const { data: grants, error } = await supabaseService
    .from("team_client_shares")
    .select("company_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("assigned_to_user_id", scope.userId)
    .eq("status", "active");
  if (error) throw error;
  return loadSafeSharedCompanies(
    (grants || []).map((grant: any) => String(grant.company_id || "")),
    scope.workspaceId
  );
}

async function loadCrmCompaniesForOutreach(
  prospectCompanyIds: string[] = []
): Promise<any[]> {
  const companies: any[] = [];
  for (let from = 0; ; from += CRM_GUARD_PAGE_SIZE) {
    let query = supabaseAdmin
      .from("companies")
      .select("id,domain,website,stage")
      .order("id", { ascending: true });
    // A shared outreach cron must never use a private account's client list as
    // hidden scoring input. Interactive users still see their own private plus
    // shared records through RLS.
    if (!getRequestScope() && isVerifiedServiceRequest()) {
      query = query.eq("visibility", "team");
    }
    const { data, error } = await query.range(
      from,
      from + CRM_GUARD_PAGE_SIZE - 1
    );
    if (error) throw error;
    companies.push(...(data || []));
    if ((data || []).length < CRM_GUARD_PAGE_SIZE) break;
  }
  const visibleIds = new Set(companies.map((company) => String(company.id || "")));
  const requestScope = getRequestScope();
  const serviceScope =
    !requestScope && isVerifiedServiceRequest()
      ? getServiceRecordScope()
      : null;
  const scope = requestScope || serviceScope;
  const safeProspectCompanyIds = Array.from(
    new Set(prospectCompanyIds.map((id) => String(id || "").trim()).filter(Boolean))
  ).slice(0, 1000);
  const [sharedCompanies, prospectCompanies] = await Promise.all([
    loadAssignedSharedCompaniesForOutreach(),
    scope && safeProspectCompanyIds.length
      ? loadSafeSharedCompanies(safeProspectCompanyIds, scope.workspaceId)
      : Promise.resolve([]),
  ]);
  // Prospect-linked companies are loaded only from IDs on records already
  // visible to this exact user. The loader exposes the fixed safe projection
  // and rejects confidential companies, so private CRM context never crosses
  // the assignment boundary while the eligibility check remains accurate.
  for (const company of [...sharedCompanies, ...prospectCompanies]) {
    const companyId = String(company.id || "");
    if (!visibleIds.has(companyId)) {
      companies.push(company);
      visibleIds.add(companyId);
    }
  }
  return companies;
}

async function loadOpenOpportunityCompanyIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += CRM_GUARD_PAGE_SIZE) {
    let query = supabaseAdmin
      .from("opportunities")
      .select("id,company_id")
      .eq("status", "open")
      .order("id", { ascending: true });
    if (!getRequestScope() && isVerifiedServiceRequest()) {
      query = query.eq("visibility", "team");
    }
    const { data, error } = await query.range(
      from,
      from + CRM_GUARD_PAGE_SIZE - 1
    );
    if (error) throw error;
    for (const opportunity of data || []) {
      if (opportunity.company_id) ids.add(String(opportunity.company_id));
    }
    if ((data || []).length < CRM_GUARD_PAGE_SIZE) break;
  }
  return ids;
}

export async function outreachCrmGuard(options: {
  prospectCompanyIds?: string[];
} = {}): Promise<OutreachCrmGuard> {
  const [companies, openOpportunityCompanyIds] = await Promise.all([
    loadCrmCompaniesForOutreach(options.prospectCompanyIds || []),
    loadOpenOpportunityCompanyIds(),
  ]);
  const guard: OutreachCrmGuard = {
    eligibleCompanyIds: new Set<string>(),
    blockedCompanyIds: new Set<string>(),
    blockedDomains: new Set<string>(),
  };

  for (const company of companies) {
    const companyId = String(company.id || "");
    const eligible = crmCompanyAllowsColdOutreach(
      company,
      openOpportunityCompanyIds
    );
    if (eligible) guard.eligibleCompanyIds.add(companyId);
    else guard.blockedCompanyIds.add(companyId);

    if (!eligible) {
      const domain = normalizeOutreachDomain(company.domain || company.website);
      if (domain) guard.blockedDomains.add(domain);
    }
  }
  return guard;
}

export function stepDelay(sequence: any, step: number): number {
  const rows = Array.isArray(sequence) ? sequence : [];
  const found = rows.find((row: any) => Number(row?.step) === step);
  return Math.max(1, Number(found?.delayDays) || 3);
}
