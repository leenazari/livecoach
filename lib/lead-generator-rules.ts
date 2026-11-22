import type { LeadGeneratorFilters } from "./lead-generator-contract.ts";

export type LeadStream = "sarah_mailer" | "reps";

export type LeadCampaignInput = {
  name: string;
  daysToRun: number;
  dailyLeadTarget: number;
  monthlyBudgetUsd: number | null;
  stream: LeadStream;
  filters: LeadGeneratorFilters;
};

const STREAMS = new Set<LeadStream>(["sarah_mailer", "reps"]);

const text = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const optionalNumber = (value: unknown) => {
  if (value == null || value === "") return { ok: true as const, value: null };
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return { ok: false as const };
  return { ok: true as const, value: amount };
};

export function canManageLeadGenerator(role: string, status: string) {
  return status === "active" && (role === "owner" || role === "manager");
}

export function streamLabel(stream: string) {
  if (stream === "sarah_mailer") return "Sarah mailer";
  if (stream === "reps") return "Reps";
  return "Unknown stream";
}

export function formatUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not returned";
  const digits = Math.abs(value) > 0 && Math.abs(value) < 1 ? 4 : 2;
  return `US$${value.toFixed(digits)}`;
}

export function safePublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function parseLeadFilters(
  input: unknown
): { ok: true; filters: LeadGeneratorFilters } | { ok: false; message: string } {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const sector = text(source.sector ?? source.search, 120);
  const city = text(source.city ?? source.area, 120);
  if (sector.length < 2 && city.length < 2) {
    return { ok: false, message: "Add a sector or a city of at least 2 characters." };
  }
  const rating = optionalNumber(source.minRating);
  if (!rating.ok || (rating.value != null && (rating.value < 1 || rating.value > 5))) {
    return { ok: false, message: "Minimum Google rating must be between 1 and 5, or left blank." };
  }
  const minReviews = optionalNumber(source.minReviews);
  const maxReviews = optionalNumber(source.maxReviews);
  const review = (parsed: { ok: boolean; value?: number | null }) => {
    if (!parsed.ok || parsed.value == null) return parsed.ok ? null : undefined;
    if (!Number.isInteger(parsed.value) || parsed.value < 0 || parsed.value > 100000) return undefined;
    return parsed.value;
  };
  const minimum = review(minReviews);
  const maximum = review(maxReviews);
  if (minimum === undefined || maximum === undefined) {
    return { ok: false, message: "Review counts must be whole numbers from 0 to 100000, or left blank." };
  }
  if (minimum != null && maximum != null && minimum > maximum) {
    return { ok: false, message: "The minimum review count cannot be higher than the maximum." };
  }
  return {
    ok: true,
    filters: {
      sector,
      city,
      minRating: rating.value == null ? null : Math.round(rating.value * 10) / 10,
      minReviews: minimum,
      maxReviews: maximum,
      mustHaveWebsite: source.mustHaveWebsite !== false && source.mustHaveWebsite !== "false",
    },
  };
}

export function parseLeadCampaign(
  input: unknown
): { ok: true; campaign: LeadCampaignInput } | { ok: false; message: string } {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const filters = parseLeadFilters(source.filters ?? source);
  if (!filters.ok) return filters;
  const name = text(source.name, 80);
  if (name.length < 2) return { ok: false, message: "Give the campaign a name of at least 2 characters." };
  const days = Number(source.daysToRun);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return { ok: false, message: "Days to run must be a whole number from 1 to 90." };
  }
  const daily = Number(source.dailyLeadTarget);
  if (!Number.isInteger(daily) || daily < 1 || daily > 200) {
    return { ok: false, message: "Daily lead target must be a whole number from 1 to 200." };
  }
  const budget = optionalNumber(source.monthlyBudgetUsd);
  if (!budget.ok || (budget.value != null && (budget.value <= 0 || budget.value > 20000))) {
    return { ok: false, message: "Monthly budget must be blank, or a USD amount up to 20000." };
  }
  const stream = String(source.stream || "");
  if (!STREAMS.has(stream as LeadStream)) {
    return { ok: false, message: "Choose Sarah mailer or Reps." };
  }
  return {
    ok: true,
    campaign: {
      name,
      daysToRun: days,
      dailyLeadTarget: daily,
      monthlyBudgetUsd: budget.value == null ? null : Math.round(budget.value * 100) / 100,
      stream: stream as LeadStream,
      filters: filters.filters,
    },
  };
}

export function toCampaignInsert(campaign: LeadCampaignInput, now = new Date().toISOString()) {
  return {
    name: campaign.name,
    status: "active" as const,
    stream: campaign.stream,
    days_to_run: campaign.daysToRun,
    daily_lead_target: campaign.dailyLeadTarget,
    monthly_budget_usd: campaign.monthlyBudgetUsd,
    filters: campaign.filters,
    updated_at: now,
  };
}

export function toCampaignUpdate(campaign: LeadCampaignInput, now = new Date().toISOString()) {
  return {
    name: campaign.name,
    stream: campaign.stream,
    days_to_run: campaign.daysToRun,
    daily_lead_target: campaign.dailyLeadTarget,
    monthly_budget_usd: campaign.monthlyBudgetUsd,
    filters: campaign.filters,
    updated_at: now,
  };
}
