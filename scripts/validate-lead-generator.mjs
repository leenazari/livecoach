import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { crmFallbackBlockerPayload } from "../lib/crm-blocker.ts";
import {
  CAMPAIGN_COLUMNS,
  CLEANSE_STEP,
  DECISION_COLUMNS,
  LEAD_BANK_TABLES,
  LEAD_GENERATOR_PATHS,
  assertLeadGeneratorOrigin,
  leadsAtListPrice,
  listPriceDailyUsd,
  listPriceMonthlyUsd,
  parseCostEstimate,
  parseSampleResponse,
  performLeadGeneratorRequest,
  sampleRequestBody,
} from "../lib/lead-generator-contract.ts";
import {
  CAMPAIGN_INSERT_KEYS,
  presentCampaigns,
} from "../lib/lead-bank-shape.ts";
import {
  CLEANSE_RESPONSE_FORMAT,
  executeLeadCleanse,
  isLeadCleanseWindow,
  leadCleanseEnabled,
  londonHour,
  parseCleanseVerdicts,
  splitDuplicateLeads,
  toCleanseDecisionRow,
} from "../lib/lead-cleanse-rules.ts";
import {
  canManageLeadGenerator,
  formatUsd,
  parseLeadCampaign,
  parseLeadFilters,
  safePublicUrl,
  toCampaignInsert,
  toCampaignUpdate,
} from "../lib/lead-generator-rules.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const page = read("app/crm/lead-generator/page.tsx");
const nav = read("components/crm/NavMenu.tsx");
const upstream = read("lib/lead-generator-upstream.ts");
const bank = read("lib/lead-bank.ts");
const run = read("lib/lead-cleanse-run.ts");
const cron = read("app/api/cron/lead-cleanse/route.ts");
const vercel = read("vercel.json");
const env = read(".env.example");
const ui = [page, nav, read("lib/crm-blocker.ts")].join("\n");

assert.equal(canManageLeadGenerator("owner", "active"), true);
assert.equal(canManageLeadGenerator("manager", "active"), true);
assert.equal(canManageLeadGenerator("sales", "active"), false);
assert.equal(canManageLeadGenerator("owner", "suspended"), false);
assert.equal(canManageLeadGenerator("manager", "onboarding"), false);

const filters = parseLeadFilters({
  search_term: "solicitors",
  sector: "solicitors",
  city: "Manchester",
  area: "Manchester",
  min_rating: "4.5",
  min_reviews: "10",
  max_reviews: "80",
  must_have_website: false,
  phone_present: true,
  opening_hours: "9 to 5",
  category_tags: ["law"],
});
assert.equal(filters.ok, true);
assert.equal(filters.filters.must_have_website, false);
assert.equal(filters.filters.phone_present, true);
assert.equal(filters.filters.opening_hours, null);
assert.deepEqual(filters.filters.category_tags, []);
assert.equal(parseLeadFilters({ min_rating: 6, sector: "law" }).ok, false);
assert.equal(parseLeadFilters({ sector: "law", min_reviews: 1.5 }).ok, false);
assert.equal(parseLeadFilters({ sector: "law", min_reviews: 20, max_reviews: 5 }).ok, false);

const campaign = parseLeadCampaign({
  name: "Manchester law",
  daysToRun: [1, 2, 3, 4, 5],
  dailyTarget: 15,
  monthlyBudgetUsd: 0,
  stream: "reps",
  ownerSplit: [{ owner: "Lee", daily: 15 }, { owner: "Nikhara", daily: 5 }],
  filters: filters.filters,
});
assert.equal(campaign.ok, false);
const saved = parseLeadCampaign({
  name: "Manchester law",
  daysToRun: [1, 2, 3, 4, 5],
  dailyTarget: 15,
  monthlyBudgetUsd: 0,
  stream: "reps",
  ownerSplit: [{ owner: "Lee", daily: 5 }, { owner: "Kamm", daily: 5 }, { owner: "Sharon", daily: 5 }],
  filters: filters.filters,
});
assert.equal(saved.ok, true);
assert.equal(saved.campaign.code, "manchester-law");
assert.equal(saved.campaign.campaign, "C1");
assert.equal(saved.campaign.criteriaSetId, "local-owners-no-chat");
assert.equal(saved.campaign.criteriaSetVersion, "1");
assert.equal(saved.campaign.monthlyBudgetUsd, 0);
assert.deepEqual(saved.campaign.daysToRun, [1, 2, 3, 4, 5]);
assert.equal(parseLeadCampaign({ ...saved.campaign, daysToRun: [8] }).ok, false);
assert.equal(parseLeadCampaign({ ...saved.campaign, daysToRun: [] }).ok, false);
assert.equal(parseLeadCampaign({ ...saved.campaign, stream: "other" }).ok, false);
assert.equal(parseLeadCampaign({ ...saved.campaign, code: "C1-sarah" }, "C1-sarah").campaign.code, "C1-sarah");
assert.deepEqual(Object.keys(toCampaignInsert(saved.campaign, "2026-11-22T00:00:00.000Z")).sort(), [...CAMPAIGN_INSERT_KEYS].sort());
assert.equal("code" in toCampaignUpdate(saved.campaign, "2026-11-22T00:00:00.000Z"), false);
assert.equal(toCampaignUpdate(saved.campaign).daily_target, 15);

const body = sampleRequestBody(filters.filters, "C1-sarah");
assert.equal(body.campaign, "C1-sarah");
assert.equal(body.filters.search_term, "solicitors");
assert.equal("limit" in body, false);
assert.equal(LEAD_GENERATOR_PATHS.sample, "/api/admin/lead-generator/sample");
assert.equal(LEAD_GENERATOR_PATHS.costEstimate, "/api/admin/lead-generator/cost-estimate");
assert.equal(listPriceDailyUsd(45, 0.006, 0.01), 3.15);
assert.equal(listPriceMonthlyUsd(3.15, 7), 95.4765);
assert.equal(leadsAtListPrice(7, 0.006, 0.01), 100);
assert.equal(parseLeadCampaign({ ...saved.campaign, maxSpendUsd: -1 }).ok, false);
assert.equal(parseLeadCampaign({ ...saved.campaign, endDate: "2026-13-40" }).ok, false);

const secret = "test-secret-value";
let seen = null;
const performed = await performLeadGeneratorRequest({
  baseUrl: "https://mailer.test",
  secret,
  path: LEAD_GENERATOR_PATHS.sample,
  method: "POST",
  body,
  timeoutMs: 1000,
  fetchImpl: async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({
      blocked: false,
      not_applied: ["opening_hours"],
      apify_cost_usd: 0.042,
      cost_basis: "list",
      leads: [{ company: `Acme ${secret}`, website: "https://acme.test", domain: "acme.test", rating: 4.6, reviews: 12, city: "Manchester", phone: "0121" }],
    }), { status: 200 });
  },
});
assert.equal(seen.init.headers.Authorization, `Bearer ${secret}`);
assert.equal(seen.init.redirect, "error");
assert.equal(seen.init.method, "POST");
assert.doesNotMatch(seen.url, /test-secret-value/);
assert.doesNotMatch(seen.init.body, /test-secret-value/);
assert.equal(JSON.parse(seen.init.body).filters.must_have_website, false);
assert.equal(seen.init.method, "POST");
assert.equal(new URL(seen.url).search, "");
const sample = parseSampleResponse(performed.payload);
assert.equal(sample.blocked, false);
assert.deepEqual(sample.notApplied, ["opening_hours"]);
assert.equal(sample.leads[0].company, "Acme");
assert.doesNotMatch(JSON.stringify(performed.payload), /test-secret-value/);
assert.equal(sample.leads[0].rating, 4.6);
assert.equal(sample.leads[0].reviews, 12);
assert.equal(sample.apifyCostUsd, 0.042);
assert.equal(parseSampleResponse({ blocked: true, reason: "campaign budget reached", leads: [] }).blocked, true);
const estimate = parseCostEstimate({
  basis: "list",
  days_of_data: 2,
  usd_per_qualified: null,
  list_prices: { checked: "2026-11-22", source: "https://apify.com/example", maps_place_usd: 0.004, maps_filter_usd: 0.001, maps_filters_applied: 2, linkedin_email_usd: 0.01, place_with_filters_usd: 0.006 },
  sample_20_places_usd: 0.12,
  campaigns: [{ code: "C1-sarah", name: "Sarah", stream: "sarah_mailer", daily_target: 45, estimated_usd: 3.15, places_priced: 450, email_lookups_priced: 45, leads_produced: 4, spend_to_date_usd: 1.2, remaining_spend_usd: null }],
});
assert.equal(estimate.basis, "list");
assert.equal(estimate.usdPerQualified, null);
assert.equal(estimate.sample20PlacesUsd, 0.12);
assert.equal(estimate.campaigns[0].estimatedUsd, 3.15);
assert.equal(estimate.campaigns[0].leadsProduced, 4);
assert.equal(estimate.campaigns[0].remainingSpendUsd, null);
assert.equal(estimate.listPrices.placeWithFiltersUsd, 0.006);

assert.throws(() => assertLeadGeneratorOrigin("http://example.com", secret), /origin/);
assert.throws(() => assertLeadGeneratorOrigin("https://example.com/api", secret), /origin/);
assert.throws(() => assertLeadGeneratorOrigin("https://user:pass@example.com", secret), /origin/);
assert.throws(() => assertLeadGeneratorOrigin(`https://example.com/?${secret}`, secret), /secret/);
assert.equal(assertLeadGeneratorOrigin("https://mailer.test", secret), "https://mailer.test");
assert.equal(assertLeadGeneratorOrigin("http://127.0.0.1:3000", secret), "http://127.0.0.1:3000");
assert.equal(safePublicUrl("javascript:alert(1)"), "");
assert.equal(formatUsd(0.042), "US$0.0420");
assert.equal(formatUsd(null), "Not returned");

assert.equal(leadCleanseEnabled({}), false);
assert.equal(leadCleanseEnabled({ LEAD_CLEANSE_ENABLED: "TRUE" }), false);
assert.equal(leadCleanseEnabled({ LEAD_CLEANSE_ENABLED: "true" }), true);
assert.equal(londonHour(new Date("2026-01-15T02:00:00Z")), 2);
assert.equal(isLeadCleanseWindow(new Date("2026-01-15T02:00:00Z")), true);
assert.equal(isLeadCleanseWindow(new Date("2026-01-15T01:00:00Z")), false);
assert.equal(isLeadCleanseWindow(new Date("2026-07-15T01:00:00Z")), true);
assert.equal(isLeadCleanseWindow(new Date("2026-07-15T02:00:00Z")), false);
assert.deepEqual(CLEANSE_RESPONSE_FORMAT.schema.properties.results.items.properties.status.enum, ["passed", "failed"]);

const lead = (id, createdAt, extra = {}) => ({
  id, createdAt, company: extra.company || `Firm ${id}`, website: extra.website || `https://${id}.test`,
  domain: extra.domain || `${id}.test`, email: extra.email || `ada@${id}.test`, contactName: "Ada Example",
  sector: "Law", city: "Manchester", area: "",
});
const split = splitDuplicateLeads([
  lead("later", "2026-01-02T00:00:00Z", { domain: "same.test", company: "Same Co" }),
  lead("earlier", "2026-01-01T00:00:00Z", { domain: "same.test", company: "Same Co" }),
]);
assert.deepEqual(split.unique.map((row) => row.id), ["earlier"]);
assert.equal(split.duplicates[0].reason, "Duplicate of another bank lead.");
const allowed = new Set(["earlier"]);
assert.deepEqual(parseCleanseVerdicts('{"results":[{"id":"earlier","status":"passed","reason":"Real firm."},{"id":"other","status":"failed","reason":"no"}]}', allowed).map((row) => row.id), ["earlier"]);
assert.equal(parseCleanseVerdicts('{"results":[{"id":"earlier","status":"maybe","reason":"no"}]}', allowed).length, 0);

const baseDeps = (overrides) => ({
  now: new Date("2026-01-15T02:00:00Z"),
  env: { LEAD_CLEANSE_ENABLED: "true" },
  loadPending: async () => { throw new Error("should not load"); },
  existingDomainHits: async () => new Set(),
  saveVerdict: async () => { throw new Error("should not save"); },
  askModel: async () => { throw new Error("should not ask"); },
  runId: "11111111-1111-4111-8111-111111111111",
  logDecision: async () => { throw new Error("should not log"); },
  ...overrides,
});
const off = await executeLeadCleanse(baseDeps({ env: {} }));
assert.equal(off.skipped, "disabled");
assert.equal(off.decisionLogged, false);
const early = await executeLeadCleanse(baseDeps({ now: new Date("2026-01-15T01:00:00Z") }));
assert.equal(early.skipped, "outside_london_window");

const savedVerdicts = [];
let logged = null;
const ran = await executeLeadCleanse(baseDeps({
  loadPending: async () => ({
    pendingCount: 3,
    leads: [lead("a", "2026-01-01T00:00:00Z"), lead("b", "2026-01-02T00:00:00Z", { domain: "same.test" }), lead("c", "2026-01-03T00:00:00Z", { domain: "same.test" })],
  }),
  saveVerdict: async (verdict) => { savedVerdicts.push(verdict); return "saved"; },
  askModel: async (leads) => ({
    text: JSON.stringify({ results: [{ id: leads[0].id, status: "passed", reason: "Real firm." }, { id: "secret-row", status: "failed", reason: "ignore" }] }),
    inputTokens: 120, outputTokens: 30, costUsd: 0.001,
  }),
  logDecision: async (row) => { logged = row; return true; },
}));
assert.equal(ran.passed, 1);
assert.equal(ran.failed, 1);
assert.equal(ran.leftPending, 1);
assert.equal(ran.decisionLogged, true);
assert.equal(logged.step, CLEANSE_STEP);
assert.equal(logged.campaign, "cleanse");
assert.equal(logged.criteria_set, "cleanse");
assert.equal(logged.apify_cost_usd, 0);
assert.equal(logged.model_cost_usd, 0.001);
assert.equal(logged.count_before, 3);
assert.equal(logged.count_after, 1);
assert.equal(logged.run_id, "11111111-1111-4111-8111-111111111111");
assert.equal(savedVerdicts.some((row) => row.id === "secret-row"), false);
assert.match(ran.note, /decision log was written/i);

const partial = await executeLeadCleanse(baseDeps({
  loadPending: async () => ({ pendingCount: 1, leads: [lead("a", "2026-01-01T00:00:00Z")] }),
  saveVerdict: async () => "saved",
  askModel: async () => { throw new Error("model down"); },
  logDecision: async () => false,
}));
assert.equal(partial.passed, 0);
assert.equal(partial.decisionLogged, false);
assert.match(partial.note, /left pending/i);
assert.match(partial.note, /decision log was not written/i);
assert.doesNotMatch(partial.note, /model down/);

const stopped = await executeLeadCleanse(baseDeps({
  loadPending: async () => ({ pendingCount: 2, leads: [lead("a", "2026-01-01T00:00:00Z", { domain: "same.test" }), lead("b", "2026-01-02T00:00:00Z", { domain: "same.test" })] }),
  saveVerdict: async () => "error",
  askModel: async () => { throw new Error("should not ask"); },
  logDecision: async () => true,
}));
assert.equal(stopped.updatesSaved, 0);
assert.match(stopped.note, /later update did not finish/i);

const presented = presentCampaigns(
  [{ id: "camp", code: "C1-reps", name: "Manchester law", campaign: "C1", active: true, stream: "reps", days_to_run: [1, 2, 3, 4, 5], daily_target: 15, monthly_budget_usd: "25.5", filters: filters.filters, owner_split: [{ owner: "Lee", daily: 15 }], criteria_set_id: "local-owners-no-chat", criteria_set_version: "1", notes: "", created_at: "2026-11-22T00:00:00Z", updated_at: "2026-11-22T00:00:00Z" }],
  [
    { id: "d1", run_id: "run", campaign: "C1-reps", criteria_set: "local-owners-no-chat@1", step: "sample", count_before: 0, count_after: 10, apify_run_id: "", apify_cost_usd: 0.2, model_cost_usd: 0, reason: "Sample kept.", created_at: "2026-11-22T01:00:00Z" },
    { id: "d2", run_id: "run-2", campaign: "cleanse", criteria_set: "cleanse", step: "cleanse", count_before: 4, count_after: 1, apify_run_id: "", apify_cost_usd: 0, model_cost_usd: 0.001, reason: "Passed 1. Failed 0. Left pending 1.", created_at: "2026-11-22T02:00:00Z" },
  ]
);
assert.equal(presented.campaigns[0].recentSpendUsd, 0.2);
assert.equal(presented.campaigns[0].recentDecisions.length, 1);
assert.equal(presented.cleanseRuns[0].id, "d2");
assert.equal(presented.campaigns[0].monthlyBudgetUsd, 25.5);
assert.equal(presented.campaigns[0].active, true);
assert.deepEqual(Object.keys(toCleanseDecisionRow({ reason: "Passed 0. Failed 0. Left pending 0.", countBefore: 4, countAfter: 4, modelCostUsd: 0 }, "run")).sort(), ["apify_cost_usd", "apify_run_id", "campaign", "count_after", "count_before", "criteria_set", "model_cost_usd", "reason", "run_id", "step"]);
assert.equal(CAMPAIGN_COLUMNS.includes("daily_target"), true);
assert.equal(CAMPAIGN_COLUMNS.includes("active"), true);
assert.equal(DECISION_COLUMNS.includes("model_cost_usd"), true);
assert.equal(DECISION_COLUMNS.includes("campaign_id"), false);
assert.equal(LEAD_BANK_TABLES.leads, "adam_pipeline_leads");

const sampleBlock = crmFallbackBlockerPayload({ status: 0, method: "POST", url: "/api/crm/lead-generator/sample" });
assert.match(sampleBlock.error, /may already have been charged/);
const saveBlock = crmFallbackBlockerPayload({ status: 504, method: "POST", url: "/api/crm/lead-generator/campaigns" });
assert.match(saveBlock.error, /Refresh the campaign list/);
assert.match(saveBlock.blocker.outcome, /may already be saved/);
const readBlock = crmFallbackBlockerPayload({ status: 500, method: "GET", url: "/api/crm/lead-generator/campaigns" });
assert.match(readBlock.error, /Lead generator could not be loaded/);
const denied = crmFallbackBlockerPayload({ status: 403, method: "GET", url: "/api/crm/lead-generator/access", serverMessage: "Only an active workspace owner or manager can use the lead generator." });
assert.match(denied.error, /owner or manager/);
for (const text of [sampleBlock.error, saveBlock.error, readBlock.error, page, nav]) assert.doesNotMatch(text, /—/);

assert.match(nav, /viewerRole === "owner" \|\| viewerRole === "manager"/);
assert.match(nav, /\/crm\/lead-generator/);
assert.match(page, /Coming soon/);
assert.match(page, /estimate at list prices/);
assert.match(page, /Maximum spend \(USD\), recommended/);
assert.match(page, /whichever comes first/);
assert.match(page, /up to 20 places/);
assert.match(page, /Completed/);
assert.match(page, /WEEKDAYS/);
assert.match(read("lib/lead-generator-rules.ts"), /Monday/);
assert.match(read("app/api/crm/lead-generator/cost-estimate/route.ts"), /fetchLeadCostEstimate\(\)/);
assert.doesNotMatch(read("app/api/crm/lead-generator/cost-estimate/route.ts"), /searchParams/);
assert.match(bank, /bank_status", "qualified"/);
assert.match(bank, /active, updated_at/);
assert.doesNotMatch(bank, /daily_lead_target|campaign_id|spend_usd/);
assert.match(page, /disabled/);
assert.match(page, /Run sample/);
assert.match(page, /Save as campaign/);
assert.doesNotMatch(page, /lead-generator-upstream|LEADGEN_API_SECRET|OUTREACHMAILER_BASE_URL|OPENAI_API_KEY|apify\.com|APIFY_/);
assert.match(upstream, /import "server-only"/);
assert.match(upstream, /OUTREACHMAILER_BASE_URL/);
assert.match(upstream, /LEADGEN_API_SECRET/);
assert.match(upstream, /performLeadGeneratorRequest/);
assert.match(bank, /cleanse_status: verdict\.status/);
assert.match(bank, /cleanse_reason: verdict\.reason/);
assert.match(bank, /\.eq\("cleanse_status", "pending"\)/);
assert.doesNotMatch(bank, /apify/i);
assert.match(run, /@\/lib\/openai/);
assert.match(run, /OPENAI_MODEL_LIVE/);
assert.match(run, /usageCostUSD/);
assert.doesNotMatch(run, /APIFY|new OpenAI|anthropic/i);
assert.match(cron, /CRON_SECRET/);
assert.match(cron, /Bearer \$\{secret\}/);
assert.match(cron, /runNightlyLeadCleanse/);
assert.match(vercel, /"path": "\/api\/cron\/lead-cleanse"/);
assert.match(vercel, /"schedule": "0 1 \* \* \*"/);
assert.match(vercel, /"schedule": "0 2 \* \* \*"/);
assert.match(env, /OUTREACHMAILER_BASE_URL=/);
assert.match(env, /LEADGEN_API_SECRET=/);
assert.match(env, /LEAD_CLEANSE_ENABLED=false/);
assert.doesNotMatch(ui, /—/);

console.log("lead generator validation passed");
