// Assumed outreachmailer contract. docs/lead-generator-contract.md was not on
// branch cursor/adam-pipeline-37f0 when this was written. Change this file
// when the real contract lands. LiveCoach never calls Apify.
//
// POST {origin}/api/admin/lead-generator/sample
// GET  {origin}/api/admin/lead-generator/cost-estimate
// Authorization: Bearer LEADGEN_API_SECRET
//
// Sample body: sector, city, minRating, minReviews, maxReviews,
// mustHaveWebsite, limit (always 10).
// Sample JSON: leads[], sampleCostUsd.
// Estimate query: the same filters plus daysToRun and dailyLeadTarget.
// Estimate JSON: filterUsd, perLeadUsd, perDayUsd, perMonthUsd.
//
// Bank tables owned by outreachmailer (LiveCoach only reads and writes rows):
// adam_lead_campaigns, adam_bank_decisions, adam_pipeline_leads.cleanse_*.

export const LEAD_GENERATOR_PATHS = {
  sample: "/api/admin/lead-generator/sample",
  costEstimate: "/api/admin/lead-generator/cost-estimate",
} as const;

export const LEAD_BANK_TABLES = {
  campaigns: "adam_lead_campaigns",
  decisions: "adam_bank_decisions",
  leads: "adam_pipeline_leads",
} as const;

export const CAMPAIGN_COLUMNS = [
  "id",
  "name",
  "status",
  "stream",
  "days_to_run",
  "daily_lead_target",
  "monthly_budget_usd",
  "filters",
  "created_at",
  "updated_at",
] as const;

export const DECISION_COLUMNS = [
  "id",
  "campaign_id",
  "step",
  "outcome",
  "reason",
  "spend_usd",
  "counts",
  "created_at",
] as const;

export const LEAD_CLEANSE_COLUMNS = [
  "id",
  "company",
  "website",
  "domain",
  "email",
  "dm_email",
  "contact_first",
  "contact_full",
  "sector",
  "city",
  "area",
  "created_at",
  "cleanse_status",
  "cleanse_reason",
  "cleansed_at",
] as const;

export const CLEANSE_STEP = "cleanse";
export const SAMPLE_LIMIT = 10;

export type LeadGeneratorFilters = {
  sector: string;
  city: string;
  minRating: number | null;
  minReviews: number | null;
  maxReviews: number | null;
  mustHaveWebsite: boolean;
};

export type SampleLead = {
  company: string;
  website: string;
  sector: string;
  city: string;
  area: string;
  rating: number | null;
  reviews: number | null;
  phone: string;
  email: string;
  contactName: string;
};

export type SampleResult = {
  leads: SampleLead[];
  sampleCostUsd: number | null;
};

export type LeadCostEstimate = {
  filterUsd: number | null;
  perLeadUsd: number | null;
  perDayUsd: number | null;
  perMonthUsd: number | null;
  notes: string;
};

type BlockerOwner = "user" | "manager" | "owner" | "system";

export class LeadGeneratorError extends Error {
  status: number;
  code: string;
  title: string;
  reason: string;
  nextAction: string;
  responsible: BlockerOwner;
  outcome?: string;

  constructor(input: {
    status: number;
    code: string;
    title: string;
    reason: string;
    nextAction: string;
    responsible?: BlockerOwner;
    outcome?: string;
  }) {
    super(input.reason);
    this.name = "LeadGeneratorError";
    this.status = input.status;
    this.code = input.code;
    this.title = input.title;
    this.reason = input.reason;
    this.nextAction = input.nextAction;
    this.responsible = input.responsible || "system";
    this.outcome = input.outcome;
  }
}

const clip = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  return Math.round(amount * 10000) / 10000;
};

const firstNumber = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in source) {
      const amount = numberOrNull(source[key]);
      if (amount != null) return amount;
    }
  }
  const nested = source.cost;
  if (nested && typeof nested === "object") {
    return firstNumber(nested as Record<string, unknown>, keys);
  }
  return null;
};

const firstText = (source: Record<string, unknown>, keys: string[], max: number) => {
  for (const key of keys) {
    const text = clip(source[key], max);
    if (text) return text;
  }
  return "";
};

export function sampleRequestBody(filters: LeadGeneratorFilters) {
  return {
    sector: filters.sector,
    city: filters.city,
    minRating: filters.minRating,
    minReviews: filters.minReviews,
    maxReviews: filters.maxReviews,
    mustHaveWebsite: filters.mustHaveWebsite,
    limit: SAMPLE_LIMIT,
  };
}

export function costEstimateQuery(input: {
  filters: LeadGeneratorFilters;
  daysToRun: number | null;
  dailyLeadTarget: number | null;
}) {
  const query = new URLSearchParams();
  const entries: Array<[string, string | number | boolean | null]> = [
    ["sector", input.filters.sector],
    ["city", input.filters.city],
    ["minRating", input.filters.minRating],
    ["minReviews", input.filters.minReviews],
    ["maxReviews", input.filters.maxReviews],
    ["mustHaveWebsite", input.filters.mustHaveWebsite],
    ["daysToRun", input.daysToRun],
    ["dailyLeadTarget", input.dailyLeadTarget],
  ];
  for (const [key, value] of entries) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  return query;
}

function leadRows(payload: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["leads", "sample", "rows", "results"]) {
    if (Array.isArray(payload[key])) {
      return payload[key].filter((row) => row && typeof row === "object") as Record<string, unknown>[];
    }
  }
  return [];
}

export function parseSampleResponse(payload: unknown): SampleResult {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const leads = leadRows(source).slice(0, SAMPLE_LIMIT).map((row) => ({
    company: firstText(row, ["company", "companyName", "name", "businessName"], 160),
    website: firstText(row, ["website", "url", "site"], 300),
    sector: firstText(row, ["sector", "category", "searchTerm"], 120),
    city: firstText(row, ["city", "town"], 120),
    area: firstText(row, ["area", "borough", "region"], 120),
    rating: firstNumber(row, ["googleScore", "google_score", "rating", "stars"]),
    reviews: (() => {
      const count = firstNumber(row, ["reviews", "reviewCount", "review_count", "userRatingsTotal"]);
      return count == null ? null : Math.round(count);
    })(),
    phone: firstText(row, ["phone", "phoneNumber"], 40),
    email: firstText(row, ["email", "dmEmail", "dm_email"], 160),
    contactName: firstText(row, ["contactName", "contact_full", "contactFull", "contact"], 120),
  }));
  return {
    leads,
    sampleCostUsd: firstNumber(source, [
      "sampleCostUsd",
      "sample_cost_usd",
      "costUsd",
      "cost_usd",
      "actualCostUsd",
      "usd",
    ]),
  };
}

export function parseCostEstimate(payload: unknown): LeadCostEstimate {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const notes = firstText(source, ["notes", "note", "detail"], 280);
  return {
    filterUsd: firstNumber(source, ["filterUsd", "filter_usd", "sampleUsd", "sample_usd", "searchUsd"]),
    perLeadUsd: firstNumber(source, ["perLeadUsd", "per_lead_usd", "leadUsd", "unitUsd"]),
    perDayUsd: firstNumber(source, ["perDayUsd", "per_day_usd", "dailyUsd", "dayUsd"]),
    perMonthUsd: firstNumber(source, ["perMonthUsd", "per_month_usd", "monthlyUsd", "monthUsd"]),
    notes: /bearer|api[_-]?key|secret|token/i.test(notes) ? "" : notes,
  };
}

export function assertLeadGeneratorOrigin(raw: string, secret: string) {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  const local = url?.hostname === "localhost" || url?.hostname === "127.0.0.1";
  const https = !!url && (url.protocol === "https:" || (url.protocol === "http:" && local));
  if (!url || !https || url.username || url.password || (url.pathname && url.pathname !== "/") || (secret && raw.includes(secret))) {
    throw new LeadGeneratorError({
      status: 503,
      code: "leadgen_base_url_invalid",
      title: "Lead generator address needs a check",
      reason: "The mailer address must be the site origin only, with https, and it must not contain the secret.",
      nextAction: "Ask a workspace owner to correct the server address. Nothing was sent.",
      outcome: "Nothing was sent.",
      responsible: "owner",
    });
  }
  return url.origin;
}

export async function performLeadGeneratorRequest(input: {
  baseUrl: string;
  secret: string;
  path: string;
  method: "GET" | "POST";
  query?: URLSearchParams;
  body?: unknown;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ status: number; payload: unknown }> {
  const url = new URL(input.path, input.baseUrl);
  if (input.query) url.search = input.query.toString();
  if (url.origin !== input.baseUrl || url.pathname !== input.path || (input.secret.length >= 12 && url.toString().includes(input.secret))) {
    throw new LeadGeneratorError({
      status: 502,
      code: "leadgen_url_rejected",
      title: "Lead generator request was stopped",
      reason: "The request did not stay on the mailer origin.",
      nextAction: "Ask a workspace owner to check the server address. Nothing was sent.",
      outcome: "Nothing was sent.",
      responsible: "owner",
    });
  }
  const response = await input.fetchImpl(url, {
    method: input.method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.secret}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    return { status: response.status, payload: null };
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 200000) {
    throw new LeadGeneratorError({
      status: 502,
      code: "leadgen_response_too_large",
      title: "Lead generator reply was incomplete",
      reason: "The mailer reply was too large to use.",
      nextAction: "Check with a workspace owner before running another sample.",
      outcome: "This sample may already have been charged.",
      responsible: "system",
    });
  }
  const text = await response.text();
  if (text.length > 200000) {
    throw new LeadGeneratorError({
      status: 502,
      code: "leadgen_response_too_large",
      title: "Lead generator reply was incomplete",
      reason: "The mailer reply was too large to use.",
      nextAction: "Check with a workspace owner before running another sample.",
      outcome: "This sample may already have been charged.",
      responsible: "system",
    });
  }
  return { status: response.status, payload: redactSecret(text ? JSON.parse(text) : {}, input.secret) };
}

export function redactSecret<T>(value: T, secret: string): T {
  if (secret.length < 12) return value;
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") return input.split(secret).join("");
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, walk(item)]));
    }
    return input;
  };
  return walk(value) as T;
}
