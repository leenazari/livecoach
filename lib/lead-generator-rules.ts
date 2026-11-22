import {
  CRITERIA_SET_ID,
  CRITERIA_SET_VERSION,
  LEAD_CAMPAIGN_TAG,
  normaliseFilters,
  type LeadGeneratorFilters,
} from "./lead-generator-contract.ts";

export const REP_OWNERS = ["Lee", "Kamm", "Sharon"] as const;
export type RepOwner = (typeof REP_OWNERS)[number];
export type LeadStream = "sarah_mailer" | "reps";
export type OwnerSplit = { owner: RepOwner; daily: number };

export const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
] as const;

export type LeadCampaignInput = {
  code: string;
  name: string;
  campaign: string;
  filters: LeadGeneratorFilters;
  criteriaSetId: string;
  criteriaSetVersion: string;
  daysToRun: number[];
  dailyTarget: number;
  monthlyBudgetUsd: number;
  totalLeadTarget: number | null;
  maxSpendUsd: number | null;
  endDate: string | null;
  active: boolean;
  stream: LeadStream;
  ownerSplit: OwnerSplit[];
  notes: string;
};

const text = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function canManageLeadGenerator(role: string, status: string) {
  return status === "active" && (role === "owner" || role === "manager");
}

export function streamLabel(stream: string) {
  if (stream === "sarah_mailer") return "Sarah mailer";
  if (stream === "reps") return "Reps";
  return "Unknown stream";
}

export function weekdayLabel(day: number) {
  return WEEKDAYS.find((item) => item.value === day)?.label || "";
}

export function formatUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not returned";
  return `US$${value.toFixed(4)}`;
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

export function campaignCodeFromName(name: string) {
  return text(name, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function notAppliedLabel(key: string) {
  if (key === "opening_hours") return "opening hours";
  if (key === "category_tags") return "category tags";
  if (key === "phone_present") return "phone number present";
  return key.replace(/_/g, " ");
}

export function parseLeadFilters(
  input: unknown
): { ok: true; filters: LeadGeneratorFilters } | { ok: false; message: string } {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const nested = record.filters && typeof record.filters === "object" && !Array.isArray(record.filters)
    ? (record.filters as Record<string, unknown>)
    : record;
  for (const [key, label] of [
    ["min_reviews", "Minimum reviews"],
    ["minReviews", "Minimum reviews"],
    ["max_reviews", "Maximum reviews"],
    ["maxReviews", "Maximum reviews"],
  ] as const) {
    const value = nested[key];
    if (value == null || value === "") continue;
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < 0 || amount > 100000) {
      return { ok: false, message: `${label} must be a whole number from 0 to 100000, or left blank.` };
    }
  }
  const filters = normaliseFilters(input);
  if (
    filters.min_rating != null &&
    (filters.min_rating < 0 || filters.min_rating > 5)
  ) {
    return { ok: false, message: "Minimum Google rating must be between 0 and 5, or left blank." };
  }
  for (const [value, label] of [
    [filters.min_reviews, "Minimum reviews"],
    [filters.max_reviews, "Maximum reviews"],
  ] as const) {
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 100000)) {
      return { ok: false, message: `${label} must be a whole number from 0 to 100000, or left blank.` };
    }
  }
  if (filters.min_reviews != null && filters.max_reviews != null && filters.min_reviews > filters.max_reviews) {
    return { ok: false, message: "The minimum review count cannot be higher than the maximum." };
  }
  return {
    ok: true,
    filters: {
      ...filters,
      min_rating: filters.min_rating == null ? null : Math.round(filters.min_rating * 10) / 10,
      opening_hours: null,
      category_tags: [],
    },
  };
}

function parseWeekdays(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const days = Array.from(new Set(value.map((day) => Number(day))));
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return null;
  return days.sort((a, b) => a - b);
}

function parseOwnerSplit(stream: LeadStream, value: unknown) {
  if (stream === "sarah_mailer") return { ok: true as const, split: [] as OwnerSplit[] };
  if (!Array.isArray(value)) return { ok: false as const, message: "Add a daily split for Lee, Kamm, or Sharon." };
  const split: OwnerSplit[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return { ok: false as const, message: "The rep split is not valid." };
    const owner = String((row as { owner?: unknown }).owner || "");
    if (owner.toLowerCase() === "nikhara") {
      return { ok: false as const, message: "Nikhara is never a rep owner." };
    }
    if (!REP_OWNERS.includes(owner as RepOwner)) {
      return { ok: false as const, message: "Rep owners are Lee, Kamm, and Sharon." };
    }
    const daily = Number((row as { daily?: unknown }).daily);
    if (!Number.isInteger(daily) || daily < 0 || daily > 200) {
      return { ok: false as const, message: "Each rep daily number must be a whole number from 0 to 200." };
    }
    if (daily > 0) split.push({ owner: owner as RepOwner, daily });
  }
  if (!split.length) return { ok: false as const, message: "Give Lee, Kamm, or Sharon a daily number above 0." };
  return { ok: true as const, split };
}

export function parseLeadCampaign(
  input: unknown,
  existingCode?: string
): { ok: true; campaign: LeadCampaignInput } | { ok: false; message: string } {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const filters = parseLeadFilters(source.filters ?? source);
  if (!filters.ok) return filters;
  const name = text(source.name, 80);
  if (name.length < 2) return { ok: false, message: "Give the campaign a name of at least 2 characters." };
  const code = existingCode || campaignCodeFromName(text(source.code, 48) || name);
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(code)) {
    return { ok: false, message: "The campaign code needs letters or numbers. Change the name and try again." };
  }
  const days = parseWeekdays(source.daysToRun ?? source.days_to_run);
  if (!days) return { ok: false, message: "Choose at least one weekday. Monday is 1 and Sunday is 7." };
  const daily = Number(source.dailyTarget ?? source.daily_target);
  if (!Number.isInteger(daily) || daily < 0 || daily > 500) {
    return { ok: false, message: "Daily target must be a whole number from 0 to 500." };
  }
  const budgetRaw = source.monthlyBudgetUsd ?? source.monthly_budget_usd;
  const budget = budgetRaw == null || budgetRaw === "" ? 0 : Number(budgetRaw);
  if (!Number.isFinite(budget) || budget < 0 || budget > 100000) {
    return { ok: false, message: "Monthly budget must be a USD amount from 0 upwards." };
  }
  const totalRaw = source.totalLeadTarget ?? source.total_lead_target;
  const totalLeadTarget = totalRaw == null || totalRaw === "" ? null : Number(totalRaw);
  if (totalLeadTarget != null && (!Number.isInteger(totalLeadTarget) || totalLeadTarget < 1 || totalLeadTarget > 100000)) {
    return { ok: false, message: "Total leads wanted must be a whole number from 1 up, or left blank." };
  }
  const spendRaw = source.maxSpendUsd ?? source.max_spend_usd;
  const maxSpendUsd = spendRaw == null || spendRaw === "" ? null : Number(spendRaw);
  if (maxSpendUsd != null && (!Number.isFinite(maxSpendUsd) || maxSpendUsd < 0 || maxSpendUsd > 1000000)) {
    return { ok: false, message: "Maximum spend must be a USD amount from 0 up, or left blank." };
  }
  const endRaw = text(source.endDate ?? source.end_date, 10);
  const endStamp = endRaw ? new Date(`${endRaw}T00:00:00Z`) : null;
  if (endRaw && (!/^\d{4}-\d{2}-\d{2}$/.test(endRaw) || !endStamp || Number.isNaN(endStamp.getTime()) || endStamp.toISOString().slice(0, 10) !== endRaw)) {
    return { ok: false, message: "End date must be a calendar date, or left blank." };
  }
  const stream = String(source.stream || "");
  if (stream !== "sarah_mailer" && stream !== "reps") {
    return { ok: false, message: "Choose Sarah mailer or Reps." };
  }
  const owners = parseOwnerSplit(stream, source.ownerSplit ?? source.owner_split);
  if (!owners.ok) return owners;
  return {
    ok: true,
    campaign: {
      code,
      name,
      campaign: LEAD_CAMPAIGN_TAG,
      filters: filters.filters,
      criteriaSetId: CRITERIA_SET_ID,
      criteriaSetVersion: CRITERIA_SET_VERSION,
      daysToRun: days,
      dailyTarget: daily,
      monthlyBudgetUsd: Math.round(budget * 100) / 100,
      totalLeadTarget,
      maxSpendUsd: maxSpendUsd == null ? null : Math.round(maxSpendUsd * 100) / 100,
      endDate: endRaw || null,
      active: source.active !== false,
      stream,
      ownerSplit: owners.split,
      notes: text(source.notes, 500),
    },
  };
}

export function toCampaignInsert(campaign: LeadCampaignInput, now = new Date().toISOString()) {
  return {
    code: campaign.code,
    name: campaign.name,
    campaign: campaign.campaign,
    filters: campaign.filters,
    criteria_set_id: campaign.criteriaSetId,
    criteria_set_version: campaign.criteriaSetVersion,
    days_to_run: campaign.daysToRun,
    daily_target: campaign.dailyTarget,
    monthly_budget_usd: campaign.monthlyBudgetUsd,
    total_lead_target: campaign.totalLeadTarget,
    max_spend_usd: campaign.maxSpendUsd,
    end_date: campaign.endDate,
    active: campaign.active,
    stream: campaign.stream,
    owner_split: campaign.ownerSplit,
    notes: campaign.notes,
    updated_at: now,
  };
}

export function toCampaignUpdate(campaign: LeadCampaignInput, now = new Date().toISOString()) {
  return {
    name: campaign.name,
    filters: campaign.filters,
    days_to_run: campaign.daysToRun,
    daily_target: campaign.dailyTarget,
    monthly_budget_usd: campaign.monthlyBudgetUsd,
    total_lead_target: campaign.totalLeadTarget,
    max_spend_usd: campaign.maxSpendUsd,
    end_date: campaign.endDate,
    stream: campaign.stream,
    owner_split: campaign.ownerSplit,
    notes: campaign.notes,
    updated_at: now,
  };
}
