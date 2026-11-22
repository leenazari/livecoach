// Outreachmailer contract from docs/lead-generator-contract.md on
// cursor/lead-bank-drain-aa5b, plus the cost-estimate handler
// api/admin/lead-generator/cost-estimate.ts. LiveCoach never calls Apify.
//
// POST /api/admin/lead-generator/sample
//   body: filters object, or { campaign, filters }
//   200: blocked, filters, not_applied, places_requested, apify_run_id,
//        apify_cost_usd, cost_basis, leads[{company, website, domain, rating, reviews, city, phone}]
//   A cap returns blocked true, empty leads, and a reason. Errors are { error } at 401, 503, or 500.
// GET /api/admin/lead-generator/cost-estimate
//   no query and no body. 200 shape is LeadCostEstimate below. Money is 4 decimal places in US dollars.
//   Each campaign has bank (qualified stock) and partials_to_process (legacy partials).
//   There is no waiting list. Partials are not bank stock.
//   It prices saved campaigns only.
// LiveCoach shows those dollars as pounds with leadgenUsdToGbpRate (LEADGEN_USD_TO_GBP, default 0.79)
// and converts pound inputs back to US dollars before saving.
// Authorization: Bearer LEADGEN_API_SECRET
//
// adam_lead_campaigns columns are CAMPAIGN_COLUMNS.
// adam_bank_decisions columns are DECISION_COLUMNS. Join on campaign code.
// Cleanse reads bank_status = qualified and cleanse_status = pending, and writes
// only cleanse_status, cleanse_reason, and cleansed_at.

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
  "code",
  "name",
  "campaign",
  "filters",
  "criteria_set_id",
  "criteria_set_version",
  "days_to_run",
  "daily_target",
  "monthly_budget_usd",
  "active",
  "stream",
  "owner_split",
  "notes",
  "total_lead_target",
  "max_spend_usd",
  "end_date",
  "completed_at",
  "completed_reason",
  "created_at",
  "updated_at",
] as const;

export const SAMPLE_PLACE_CAP = 20;

export const DECISION_COLUMNS = [
  "id",
  "run_id",
  "campaign",
  "criteria_set",
  "step",
  "count_before",
  "count_after",
  "apify_run_id",
  "apify_cost_usd",
  "model_cost_usd",
  "reason",
  "created_at",
] as const;

export const LEAD_CAMPAIGN_TAG = "C1";
export const CRITERIA_SET_ID = "local-owners-no-chat";
export const CRITERIA_SET_VERSION = "1";
export const CLEANSE_CAMPAIGN = "cleanse";
export const CLEANSE_CRITERIA_SET = "cleanse";
export const LIST_PRICE_WEEKS_PER_MONTH = 4.33;
export const DEFAULT_USD_TO_GBP = 0.79;

export function leadgenUsdToGbpRate(env: NodeJS.ProcessEnv = process.env) {
  const rate = Number(env.LEADGEN_USD_TO_GBP);
  if (Number.isFinite(rate) && rate > 0 && rate < 5) return rate;
  return DEFAULT_USD_TO_GBP;
}

export function usdToGbp(usd: number, rate = leadgenUsdToGbpRate()) {
  return usd * rate;
}

export function gbpToUsd(gbp: number, rate = leadgenUsdToGbpRate()) {
  return gbp / rate;
}

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

export type LeadGeneratorFilters = {
  search_term: string;
  sector: string;
  city: string;
  area: string;
  min_rating: number | null;
  min_reviews: number | null;
  max_reviews: number | null;
  must_have_website: boolean;
  opening_hours: string | null;
  category_tags: string[];
  phone_present: boolean;
};

export type SampleLead = {
  company: string;
  website: string;
  domain: string;
  rating: number | null;
  reviews: number | null;
  city: string;
  phone: string;
};

export type SampleResult = {
  blocked: boolean;
  reason: string;
  filters: LeadGeneratorFilters | null;
  notApplied: string[];
  placesRequested: number | null;
  apifyRunId: string;
  apifyCostUsd: number | null;
  costBasis: string;
  leads: SampleLead[];
};

export type LeadCostCampaign = {
  code: string;
  name: string;
  stream: string;
  dailyTarget: number | null;
  estimatedUsd: number | null;
  placesPriced: number | null;
  emailLookupsPriced: number | null;
  leadsProduced: number | null;
  spendToDateUsd: number | null;
  remainingSpendUsd: number | null;
  bank: number | null;
  partialsToProcess: number | null;
};

export type LeadCostEstimate = {
  basis: "" | "list" | "actual";
  daysOfData: number | null;
  usdPerQualified: number | null;
  listPrices: {
    checked: string;
    source: string;
    mapsPlaceUsd: number | null;
    mapsFilterUsd: number | null;
    mapsFiltersApplied: number | null;
    linkedinEmailUsd: number | null;
    placeWithFiltersUsd: number | null;
  };
  sample20PlacesUsd: number | null;
  campaigns: LeadCostCampaign[];
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const countOrNull = (value: unknown) => {
  const amount = numberOrNull(value);
  return amount == null ? null : Math.round(amount);
};

export function normaliseFilters(raw: unknown): LeadGeneratorFilters {
  const body = asRecord(raw);
  const nested = asRecord(body?.filters);
  const source = nested || body || {};
  const tags = source.category_tags ?? source.categoryTags;
  const opening = clip(source.opening_hours ?? source.openingHours, 160);
  const website = source.must_have_website ?? source.mustHaveWebsite;
  const phone = source.phone_present ?? source.phonePresent;
  return {
    search_term: clip(source.search_term ?? source.searchTerm, 160),
    sector: clip(source.sector, 160),
    city: clip(source.city, 160),
    area: clip(source.area, 160),
    min_rating: numberOrNull(source.min_rating ?? source.minRating),
    min_reviews: countOrNull(source.min_reviews ?? source.minReviews),
    max_reviews: countOrNull(source.max_reviews ?? source.maxReviews),
    must_have_website: website === false || website === "false" ? false : true,
    opening_hours: opening || null,
    category_tags: Array.isArray(tags)
      ? tags.map((tag) => clip(tag, 80)).filter(Boolean).slice(0, 20)
      : [],
    phone_present: phone === true || phone === "true",
  };
}

export function sampleRequestBody(filters: LeadGeneratorFilters, campaignCode?: string) {
  return campaignCode ? { campaign: campaignCode, filters } : filters;
}

export function listPriceDailyUsd(
  dailyTarget: number,
  placeWithFiltersUsd: number,
  linkedinEmailUsd: number
) {
  if (!Number.isFinite(dailyTarget) || dailyTarget < 0) return null;
  if (!Number.isFinite(placeWithFiltersUsd) || !Number.isFinite(linkedinEmailUsd)) return null;
  return Math.round((dailyTarget * 10 * placeWithFiltersUsd + dailyTarget * linkedinEmailUsd) * 10000) / 10000;
}

export function listPricePerLeadUsd(placeWithFiltersUsd: number, linkedinEmailUsd: number) {
  if (!Number.isFinite(placeWithFiltersUsd) || !Number.isFinite(linkedinEmailUsd)) return null;
  return Math.round((10 * placeWithFiltersUsd + linkedinEmailUsd) * 10000) / 10000;
}

export function leadsAtListPrice(maxSpendUsd: number, placeWithFiltersUsd: number, linkedinEmailUsd: number) {
  const perLead = listPricePerLeadUsd(placeWithFiltersUsd, linkedinEmailUsd);
  if (perLead == null || perLead <= 0 || !Number.isFinite(maxSpendUsd) || maxSpendUsd < 0) return null;
  return Math.floor(maxSpendUsd / perLead + 1e-8);
}

export function listPriceMonthlyUsd(perDayUsd: number, weekdaysPerWeek: number) {
  if (!Number.isFinite(perDayUsd) || !Number.isInteger(weekdaysPerWeek) || weekdaysPerWeek < 0 || weekdaysPerWeek > 7) {
    return null;
  }
  return Math.round(perDayUsd * weekdaysPerWeek * LIST_PRICE_WEEKS_PER_MONTH * 10000) / 10000;
}

export function parseSampleResponse(payload: unknown): SampleResult {
  const source = asRecord(payload) || {};
  const leads = (Array.isArray(source.leads) ? source.leads : [])
    .filter((row) => row && typeof row === "object")
    .slice(0, SAMPLE_PLACE_CAP)
    .map((row) => {
      const lead = row as Record<string, unknown>;
      const reviews = numberOrNull(lead.reviews);
      return {
        company: clip(lead.company, 160),
        website: clip(lead.website, 300),
        domain: clip(lead.domain, 160),
        rating: numberOrNull(lead.rating),
        reviews: reviews == null ? null : Math.round(reviews),
        city: clip(lead.city, 120),
        phone: clip(lead.phone, 40),
      };
    });
  const basis = clip(source.cost_basis, 20);
  return {
    blocked: source.blocked === true,
    reason: clip(source.reason, 280),
    filters: source.filters ? normaliseFilters(source.filters) : null,
    notApplied: Array.isArray(source.not_applied)
      ? source.not_applied.map((item) => clip(item, 40)).filter(Boolean)
      : [],
    placesRequested: countOrNull(source.places_requested),
    apifyRunId: clip(source.apify_run_id, 80),
    apifyCostUsd: numberOrNull(source.apify_cost_usd),
    costBasis: basis === "actual" || basis === "list" ? basis : "",
    leads,
  };
}

export function parseCostEstimate(payload: unknown): LeadCostEstimate {
  const source = asRecord(payload) || {};
  const prices = asRecord(source.list_prices) || {};
  const basis = clip(source.basis, 20);
  const campaigns = (Array.isArray(source.campaigns) ? source.campaigns : [])
    .filter((row) => row && typeof row === "object")
    .slice(0, 50)
    .map((row) => {
      const campaign = row as Record<string, unknown>;
      return {
        code: clip(campaign.code, 80),
        name: clip(campaign.name, 80),
        stream: clip(campaign.stream, 40),
        dailyTarget: countOrNull(campaign.daily_target),
        estimatedUsd: numberOrNull(campaign.estimated_usd),
        placesPriced: countOrNull(campaign.places_priced),
        emailLookupsPriced: countOrNull(campaign.email_lookups_priced),
        leadsProduced: countOrNull(campaign.leads_produced),
        spendToDateUsd: numberOrNull(campaign.spend_to_date_usd),
        remainingSpendUsd: campaign.remaining_spend_usd == null ? null : numberOrNull(campaign.remaining_spend_usd),
        bank: countOrNull(campaign.bank),
        partialsToProcess: countOrNull(campaign.partials_to_process),
      };
    });
  return {
    basis: basis === "list" || basis === "actual" ? basis : "",
    daysOfData: countOrNull(source.days_of_data),
    usdPerQualified: numberOrNull(source.usd_per_qualified),
    listPrices: {
      checked: clip(prices.checked, 20),
      source: /^https:\/\//.test(clip(prices.source, 200)) ? clip(prices.source, 200) : "",
      mapsPlaceUsd: numberOrNull(prices.maps_place_usd),
      mapsFilterUsd: numberOrNull(prices.maps_filter_usd),
      mapsFiltersApplied: countOrNull(prices.maps_filters_applied),
      linkedinEmailUsd: numberOrNull(prices.linkedin_email_usd),
      placeWithFiltersUsd: numberOrNull(prices.place_with_filters_usd),
    },
    sample20PlacesUsd: numberOrNull(source.sample_20_places_usd),
    campaigns,
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
