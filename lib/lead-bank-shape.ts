import type { LeadGeneratorFilters } from "./lead-generator-contract.ts";
import { parseLeadFilters } from "./lead-generator-rules.ts";

export type PublicDecision = {
  id: string;
  campaignId: string | null;
  step: string;
  outcome: string;
  reason: string;
  spendUsd: number | null;
  createdAt: string;
  counts: Record<string, number> | null;
};

export type PublicCampaign = {
  id: string;
  name: string;
  status: "active" | "paused" | "unknown";
  stream: string;
  daysToRun: number;
  dailyLeadTarget: number;
  monthlyBudgetUsd: number | null;
  filters: LeadGeneratorFilters | null;
  createdAt: string;
  updatedAt: string;
  recentDecisions: PublicDecision[];
  recentSpendUsd: number;
};

const money = (value: unknown) => {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 10000) / 10000;
};

const countsOf = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const counts: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key)) continue;
    if (typeof item === "number" && Number.isFinite(item)) counts[key] = item;
  }
  return Object.keys(counts).length ? counts : null;
};

export function isMissingLeadBankError(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code || "");
  const message = String((error as { message?: unknown } | null)?.message || "");
  return (
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) ||
    /does not exist|schema cache|could not find the/i.test(message)
  );
}

export function toPublicDecision(row: unknown): PublicDecision | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const id = String(source.id || "");
  if (!id) return null;
  const status = String(source.step || "");
  return {
    id,
    campaignId: source.campaign_id ? String(source.campaign_id) : null,
    step: status.slice(0, 40),
    outcome: String(source.outcome || "").slice(0, 40),
    reason: String(source.reason || "").replace(/\s+/g, " ").trim().slice(0, 240),
    spendUsd: money(source.spend_usd),
    createdAt: String(source.created_at || ""),
    counts: countsOf(source.counts),
  };
}

export function toPublicCampaign(row: unknown): PublicCampaign | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const id = String(source.id || "");
  if (!id) return null;
  const filters = parseLeadFilters(source.filters);
  const status = source.status === "active" || source.status === "paused" ? source.status : "unknown";
  return {
    id,
    name: String(source.name || "Untitled campaign").slice(0, 80),
    status,
    stream: String(source.stream || ""),
    daysToRun: Number(source.days_to_run) || 0,
    dailyLeadTarget: Number(source.daily_lead_target) || 0,
    monthlyBudgetUsd: money(source.monthly_budget_usd),
    filters: filters.ok ? filters.filters : null,
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
      const recentDecisions = decisionRows.filter((row) => row.campaignId === campaign.id).slice(0, 8);
      const recentSpendUsd = Math.round(
        recentDecisions.reduce((sum, row) => sum + (row.spendUsd || 0), 0) * 10000
      ) / 10000;
      return { ...campaign, recentDecisions, recentSpendUsd };
    });
  return {
    campaigns,
    cleanseRuns: decisionRows.filter((row) => row.step === "cleanse").slice(0, 10),
  };
}

export const CAMPAIGN_INSERT_KEYS = [
  "daily_lead_target",
  "days_to_run",
  "filters",
  "monthly_budget_usd",
  "name",
  "status",
  "stream",
  "updated_at",
];
