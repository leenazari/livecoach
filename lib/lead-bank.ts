import "server-only";

import { supabaseService } from "@/lib/supabase";
import {
  CAMPAIGN_COLUMNS,
  DECISION_COLUMNS,
  LEAD_BANK_TABLES,
  LeadGeneratorError,
} from "@/lib/lead-generator-contract";
import {
  toCampaignInsert,
  toCampaignUpdate,
  type LeadCampaignInput,
} from "@/lib/lead-generator-rules";
import { isDuplicateCampaignCode, isMissingLeadBankError, presentCampaigns, toPublicCampaign } from "@/lib/lead-bank-shape";
import {
  domainKey,
  toCleanseDecisionRow,
  type CleanseLead,
  type CleanseVerdict,
} from "@/lib/lead-cleanse-rules";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const safeCode = (error: unknown) => {
  const code = String((error as { code?: unknown } | null)?.code || "");
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : "request_failed";
};

function bankError(action: string, error: unknown, outcome: string) {
  console.error("lead_bank_failed", { action, code: safeCode(error) });
  if (isDuplicateCampaignCode(error)) {
    return new LeadGeneratorError({
      status: 409,
      code: "lead_campaign_code_taken",
      title: "That campaign code is already used",
      reason: "Another campaign already uses this code.",
      nextAction: "Change the name so the code is different, then save again.",
      outcome: "Nothing was saved.",
      responsible: "user",
    });
  }
  if (isMissingLeadBankError(error)) {
    return new LeadGeneratorError({
      status: 503,
      code: "lead_bank_not_ready",
      title: "Lead bank is not ready",
      reason: "The mailer tables for campaigns or decisions are not available yet.",
      nextAction: "Ask a workspace owner to apply the outreachmailer lead generator migration, then refresh this page.",
      outcome,
      responsible: "owner",
    });
  }
  return new LeadGeneratorError({
    status: 502,
    code: "lead_bank_failed",
    title: `${action} could not be confirmed`,
    reason: "The lead bank did not confirm the result.",
    nextAction: "Refresh the campaign list and check whether the change is already there before trying again.",
    outcome,
    responsible: "system",
  });
}

async function query<T>(
  action: string,
  outcome: string,
  work: () => PromiseLike<{ data: T; error: unknown }>
) {
  let result: { data: T; error: unknown };
  try {
    result = await work();
  } catch (error) {
    throw bankError(action, error, "The result could not be checked. Refresh the list before trying again.");
  }
  if (result.error) throw bankError(action, result.error, outcome);
  return result.data;
}

function requireId(id: string) {
  if (!UUID.test(id)) {
    throw new LeadGeneratorError({
      status: 400,
      code: "lead_campaign_invalid",
      title: "Campaign could not be found",
      reason: "That campaign reference is not valid.",
      nextAction: "Refresh the list and choose the campaign again. Nothing was changed.",
      outcome: "Nothing was changed.",
      responsible: "user",
    });
  }
}

export async function listLeadCampaigns() {
  const campaigns = await query("Campaign list", "No campaigns were changed.", () =>
    supabaseService
      .from(LEAD_BANK_TABLES.campaigns)
      .select(CAMPAIGN_COLUMNS.join(","))
      .order("updated_at", { ascending: false })
      .limit(50)
  );
  let decisions: unknown[] = [];
  let decisionsUnavailable = false;
  try {
    const result = await supabaseService
      .from(LEAD_BANK_TABLES.decisions)
      .select(DECISION_COLUMNS.join(","))
      .order("created_at", { ascending: false })
      .limit(200);
    if (result.error) throw result.error;
    decisions = result.data || [];
  } catch (error) {
    console.error("lead_bank_failed", { action: "decisions", code: safeCode(error) });
    decisionsUnavailable = true;
  }
  return { ...presentCampaigns(campaigns || [], decisions), decisionsUnavailable };
}

export async function createLeadCampaign(campaign: LeadCampaignInput) {
  const row = await query("Campaign save", "Nothing was saved.", () =>
    supabaseService
      .from(LEAD_BANK_TABLES.campaigns)
      .insert(toCampaignInsert(campaign))
      .select(CAMPAIGN_COLUMNS.join(","))
      .single()
  );
  const publicRow = toPublicCampaign(row);
  if (!publicRow) throw bankError("Campaign save", new Error("empty"), "Refresh the list before saving another campaign.");
  return publicRow;
}

export async function updateLeadCampaign(id: string, campaign: LeadCampaignInput) {
  requireId(id);
  const row = await query("Campaign update", "The previous campaign details are unchanged if this failed.", () =>
    supabaseService
      .from(LEAD_BANK_TABLES.campaigns)
      .update(toCampaignUpdate(campaign))
      .eq("id", id)
      .select(CAMPAIGN_COLUMNS.join(","))
      .maybeSingle()
  );
  const publicRow = toPublicCampaign(row);
  if (!publicRow) {
    throw new LeadGeneratorError({
      status: 404,
      code: "lead_campaign_missing",
      title: "Campaign is not in the list",
      reason: "That campaign could not be found.",
      nextAction: "Refresh the list before editing again. Nothing else was changed.",
      outcome: "Nothing was changed.",
      responsible: "user",
    });
  }
  return publicRow;
}

export async function setLeadCampaignActive(id: string, active: boolean) {
  requireId(id);
  const row = await query(active ? "Campaign resume" : "Campaign pause", "The previous active flag still applies if this failed.", () =>
    supabaseService
      .from(LEAD_BANK_TABLES.campaigns)
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(CAMPAIGN_COLUMNS.join(","))
      .maybeSingle()
  );
  const publicRow = toPublicCampaign(row);
  if (!publicRow) {
    throw new LeadGeneratorError({
      status: 404,
      code: "lead_campaign_missing",
      title: "Campaign is not in the list",
      reason: "That campaign could not be found.",
      nextAction: "Refresh the list before changing it again. Nothing else was changed.",
      outcome: "Nothing was changed.",
      responsible: "user",
    });
  }
  return publicRow;
}

const leadSelect = "id, company, website, domain, email, dm_email, contact_first, contact_full, sector, city, area, created_at";

export async function loadPendingCleanseLeads(limit: number) {
  const countResult = await supabaseService
    .from(LEAD_BANK_TABLES.leads)
    .select("id", { count: "exact", head: true })
    .eq("bank_status", "qualified")
    .eq("cleanse_status", "pending");
  if (countResult.error) throw countResult.error;
  const rows = await supabaseService
    .from(LEAD_BANK_TABLES.leads)
    .select(leadSelect)
    .eq("bank_status", "qualified")
    .eq("cleanse_status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (rows.error) throw rows.error;
  const leads: CleanseLead[] = (rows.data || []).map((row) => ({
    id: String(row.id || ""),
    company: String(row.company || ""),
    website: String(row.website || ""),
    domain: String(row.domain || ""),
    email: String(row.email || row.dm_email || ""),
    contactName: String(row.contact_full || row.contact_first || ""),
    sector: String(row.sector || ""),
    city: String(row.city || ""),
    area: String(row.area || ""),
    createdAt: String(row.created_at || ""),
  })).filter((lead) => lead.id);
  return { leads, pendingCount: countResult.count || leads.length };
}

export async function existingCleanseDomains(domains: string[], ignoreIds: Set<string>) {
  const safe = Array.from(new Set(
    domains.map((domain) => domain.toLowerCase().replace(/^www\./, "")).filter((domain) => /^[a-z0-9.-]+$/.test(domain))
  ));
  if (!safe.length) return new Set<string>();
  const variants = safe.flatMap((domain) => [domain, `www.${domain}`]);
  const result = await supabaseService
    .from(LEAD_BANK_TABLES.leads)
    .select("id, domain, website")
    .or(variants.map((domain) => `domain.ilike.${domain}`).join(","))
    .limit(300);
  if (result.error) throw result.error;
  const hits = new Set<string>();
  for (const row of result.data || []) {
    if (!row?.id || ignoreIds.has(String(row.id))) continue;
    const key = domainKey({ domain: String(row.domain || ""), website: String(row.website || "") });
    if (key && safe.includes(key)) hits.add(key);
  }
  return hits;
}

export async function saveCleanseVerdict(verdict: CleanseVerdict): Promise<"saved" | "missed" | "error"> {
  const result = await supabaseService
    .from(LEAD_BANK_TABLES.leads)
    .update({
      cleanse_status: verdict.status,
      cleanse_reason: verdict.reason,
      cleansed_at: new Date().toISOString(),
    })
    .eq("id", verdict.id)
    .eq("cleanse_status", "pending")
    .select("id");
  if (result.error) {
    console.error("lead_bank_failed", { action: "cleanse_update", code: safeCode(result.error) });
    return "error";
  }
  return result.data?.length ? "saved" : "missed";
}

export async function logCleanseDecision(row: ReturnType<typeof toCleanseDecisionRow>) {
  const result = await supabaseService.from(LEAD_BANK_TABLES.decisions).insert(row).select("id");
  if (result.error) {
    console.error("lead_bank_failed", { action: "cleanse_decision", code: safeCode(result.error) });
    return false;
  }
  return !!result.data?.length;
}
