import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { crmFallbackBlockerPayload } from "../lib/crm-blocker.ts";
import {
  CAMPAIGN_COLUMNS,
  CLEANSE_STEP,
  DECISION_COLUMNS,
  LEAD_BANK_TABLES,
  LEAD_GENERATOR_PATHS,
  SAMPLE_LIMIT,
  assertLeadGeneratorOrigin,
  costEstimateQuery,
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
  sector: "solicitors",
  city: "Manchester",
  minRating: "4.5",
  minReviews: "10",
  maxReviews: "80",
  mustHaveWebsite: false,
  openingHours: true,
  categoryTags: true,
  phonePresent: true,
});
assert.equal(filters.ok, true);
assert.equal(filters.filters.mustHaveWebsite, false);
assert.deepEqual(Object.keys(filters.filters).sort(), ["city", "maxReviews", "minRating", "minReviews", "mustHaveWebsite", "sector"]);
assert.equal(parseLeadFilters({ sector: "a", city: "" }).ok, false);
assert.equal(parseLeadFilters({ minRating: 6, sector: "law" }).ok, false);
assert.equal(parseLeadFilters({ sector: "law", minReviews: 1.5 }).ok, false);
assert.equal(parseLeadFilters({ sector: "law", minReviews: 20, maxReviews: 5 }).ok, false);

const campaign = parseLeadCampaign({
  name: "Manchester law",
  daysToRun: 14,
  dailyLeadTarget: 15,
  monthlyBudgetUsd: "",
  stream: "sarah_mailer",
  filters: filters.filters,
});
assert.equal(campaign.ok, true);
assert.equal(campaign.campaign.monthlyBudgetUsd, null);
assert.equal(parseLeadCampaign({ ...campaign.campaign, daysToRun: 91 }).ok, false);
assert.equal(parseLeadCampaign({ ...campaign.campaign, dailyLeadTarget: 0 }).ok, false);
assert.equal(parseLeadCampaign({ ...campaign.campaign, stream: "other" }).ok, false);
assert.equal(parseLeadCampaign({ ...campaign.campaign, monthlyBudgetUsd: 0 }).ok, false);
assert.deepEqual(Object.keys(toCampaignInsert(campaign.campaign, "2026-11-22T00:00:00.000Z")).sort(), [...CAMPAIGN_INSERT_KEYS].sort());

const body = sampleRequestBody(filters.filters);
assert.equal(body.limit, SAMPLE_LIMIT);
assert.equal("openingHours" in body, false);
assert.equal(LEAD_GENERATOR_PATHS.sample, "/api/admin/lead-generator/sample");
assert.equal(LEAD_GENERATOR_PATHS.costEstimate, "/api/admin/lead-generator/cost-estimate");
const query = costEstimateQuery({ filters: filters.filters, daysToRun: 14, dailyLeadTarget: 15 });
assert.equal(query.get("daysToRun"), "14");
assert.equal(query.get("mustHaveWebsite"), "false");

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
      leads: [{ company: `Acme ${secret}`, website: "https://acme.test", google_score: 4.6, review_count: 12 }],
      sample_cost_usd: 0.042,
    }), { status: 200 });
  },
});
assert.equal(seen.init.headers.Authorization, `Bearer ${secret}`);
assert.equal(seen.init.redirect, "error");
assert.equal(seen.init.method, "POST");
assert.doesNotMatch(seen.url, /test-secret-value/);
assert.doesNotMatch(seen.init.body, /test-secret-value/);
assert.equal(JSON.parse(seen.init.body).limit, 10);
const sample = parseSampleResponse(performed.payload);
assert.equal(sample.leads[0].company, "Acme");
assert.doesNotMatch(JSON.stringify(performed.payload), /test-secret-value/);
assert.equal(sample.leads[0].rating, 4.6);
assert.equal(sample.leads[0].reviews, 12);
assert.equal(sample.sampleCostUsd, 0.042);
assert.equal(parseCostEstimate({
  filter_usd: 0.4,
  per_lead_usd: 0.04,
  per_day_usd: 1.25,
  per_month_usd: 30,
  notes: "Bearer hidden secret",
}).notes, "");
assert.equal(parseCostEstimate({ perDayUsd: 2, perMonthUsd: 40 }).perMonthUsd, 40);

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
  logDecision: async () => { throw new Error("should not log"); },
  ...overrides,
});
const off = await executeLeadCleanse(baseDeps({ env: {} }));
assert.equal(off.skipped, "disabled");
assert.equal(off.decisionLogged, false);
const early = await executeLeadCleanse(baseDeps({ now: new Date("2026-01-15T01:00:00Z") }));
assert.equal(early.skipped, "outside_london_window");

const saved = [];
let logged = null;
const ran = await executeLeadCleanse(baseDeps({
  loadPending: async () => ({
    pendingCount: 3,
    leads: [lead("a", "2026-01-01T00:00:00Z"), lead("b", "2026-01-02T00:00:00Z", { domain: "same.test" }), lead("c", "2026-01-03T00:00:00Z", { domain: "same.test" })],
  }),
  saveVerdict: async (verdict) => { saved.push(verdict); return "saved"; },
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
assert.equal(logged.campaign_id, null);
assert.equal(logged.spend_usd, 0.001);
assert.equal(saved.some((row) => row.id === "secret-row"), false);
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
  [{ id: "camp", name: "Manchester law", status: "active", stream: "reps", days_to_run: 14, daily_lead_target: 15, monthly_budget_usd: "25.5", filters: filters.filters, created_at: "2026-11-22T00:00:00Z", updated_at: "2026-11-22T00:00:00Z" }],
  [
    { id: "d1", campaign_id: "camp", step: "sample", outcome: "kept", reason: "Sample kept.", spend_usd: 0.2, counts: { leads: 10 }, created_at: "2026-11-22T01:00:00Z" },
    { id: "d2", campaign_id: null, step: "cleanse", outcome: "completed", reason: "Passed 1. Failed 0. Left pending 0.", spend_usd: 0.001, counts: { passed: 1 }, created_at: "2026-11-22T02:00:00Z" },
  ]
);
assert.equal(presented.campaigns[0].recentSpendUsd, 0.2);
assert.equal(presented.campaigns[0].recentDecisions.length, 1);
assert.equal(presented.cleanseRuns[0].id, "d2");
assert.equal(presented.campaigns[0].monthlyBudgetUsd, 25.5);
assert.deepEqual(Object.keys(toCleanseDecisionRow({ outcome: "completed", reason: "Passed 0. Failed 0. Left pending 0.", spendUsd: 0, counts: { passed: 0 } })).sort(), ["campaign_id", "counts", "outcome", "reason", "spend_usd", "step"]);
assert.deepEqual(CAMPAIGN_COLUMNS.includes("filters"), true);
assert.equal(DECISION_COLUMNS.includes("spend_usd"), true);
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
