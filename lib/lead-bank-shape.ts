import type { LeadGeneratorFilters } from "./lead-generator-contract.ts";
import { parseLeadFilters } from "./lead-generator-rules.ts";
import type { OwnerSplit } from "./lead-generator-rules.ts";

export type PublicDecision = {
  id: string;
  runId: string;
  campaign: string;
  criteriaSet: string;
  step: string;
  countBefore: number;
  countAfter: number;
  apifyCostUsd: number;
  modelCostUsd: number;
  reason: string;
  createdAt: string;
};

export type PublicCampaign = {
  id: string;
  code: string;
  name: string;
  campaign: string;
  filters: LeadGeneratorFilters | null;
  criteriaSetId: string;
  criteriaSetVersion: string;
  daysToRun: number[];
  dailyTarget: number;
  monthlyBudgetUsd: number;
  active: boolean;
  stream: string;
  ownerSplit: OwnerSplit[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  recentDecisions: PublicDecision[];
  recentSpendUsd: number;
};

const money = (value: unknown) => {
  if (value == null || value === "") return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 10000) / 10000;
};

const whole = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
};

export function isMissingLeadBankError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code || "");
  const message = String((error as { message?: unknown } | null)?.message || "");
  return (
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) ||
    /does not exist|schema cache|could not find the/i.test(message)
  );
}

export function isDuplicateCampaignCode(error: unknown) {
  return String((error as { code?: unknown } | null)?.code || "") === "23505";
}

function ownerSplit(value: unknown): OwnerSplit[] {
  if (!Array.isArray(value)) return [];
  const owners = new Set(["Lee", "Kamm", "Sharon"]);
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const owner = String((row as { owner?: unknown }).owner || "");
    const daily = whole((row as { daily?: unknown }).daily);
    if (!owners.has(owner) || daily <= 0) return [];
    return [{ owner: owner as OwnerSplit["owner"], daily }];
  });
}

function weekdays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((day) => Number(day))))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b);
}

export function toPublicDecision(row: unknown): PublicDecision | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const id = String(source.id || "");
  if (!id) return null;
  return {
    id,
    runId: String(source.run_id || ""),
    campaign: String(source.campaign || "").slice(0, 80),
    criteriaSet: String(source.criteria_set || "").slice(0, 80),
    step: String(source.step || "").slice(0, 40),
    countBefore: whole(source.count_before),
    countAfter: whole(source.count_after),
    apifyCostUsd: money(source.apify_cost_usd),
    modelCostUsd: money(source.model_cost_usd),
    reason: String(source.reason || "").replace(/\s+/g, " ").trim().slice(0, 280),
    createdAt: String(source.created_at || ""),
  };
}

export function toPublicCampaign(row: unknown): PublicCampaign | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const id = String(source.id || "");
  const code = String(source.code || "");
  if (!id || !code) return null;
  const filters = parseLeadFilters(source.filters);
  return {
    id,
    code: code.slice(0, 80),
    name: String(source.name || "Untitled campaign").slice(0, 80),
    campaign: String(source.campaign || "C1").slice(0, 40),
    filters: filters.ok ? filters.filters : null,
    criteriaSetId: String(source.criteria_set_id || ""),
    criteriaSetVersion: String(source.criteria_set_version || ""),
    daysToRun: weekdays(source.days_to_run),
    dailyTarget: whole(source.daily_target),
    monthlyBudgetUsd: money(source.monthly_budget_usd),
    active: source.active !== false,
    stream: String(source.stream || ""),
    ownerSplit: ownerSplit(source.owner_split),
    notes: String(source.notes || "").slice(0, 500),
    createdAt: String(source.created_at || ""),
    updatedAt: String(source.updated_at || ""),
    recentDecisions: [],
    recentSpendUsd: 0,
  };
}

export function presentCampaigns(rows: unknown, decisions: unknown) {
  const decisionRows = (Array.isArray(decisions) ? decisions : [])
    .map(toPublicDecision)
    .filter((row): row is PublicDecision => !!row);
  const campaigns = (Array.isArray(rows) ? rows : [])
    .map(toPublicCampaign)
    .filter((row): row is PublicCampaign => !!row)
    .map((campaign) => {
      const recentDecisions = decisionRows.filter((row) => row.campaign === campaign.code).slice(0, 8);
      const recentSpendUsd = Math.round(
        recentDecisions.reduce((sum, row) => sum + row.apifyCostUsd + row.modelCostUsd, 0) * 10000
      ) / 10000;
      return { ...campaign, recentDecisions, recentSpendUsd };
    });
  return {
    campaigns,
    cleanseRuns: decisionRows.filter((row) => row.step === "cleanse" || row.campaign === "cleanse").slice(0, 10),
  };
}

export const CAMPAIGN_INSERT_KEYS = [
  "active",
  "campaign",
  "code",
  "criteria_set_id",
  "criteria_set_version",
  "daily_target",
  "days_to_run",
  "filters",
  "monthly_budget_usd",
  "name",
  "notes",
  "owner_split",
  "stream",
  "updated_at",
];
