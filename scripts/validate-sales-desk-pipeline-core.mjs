import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWorkPipeline } from "../lib/work-inbox.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const nowMs = Date.parse("2026-08-24T12:00:00Z");
const companyName = new Map([
  ["company-a", "Alpha"],
  ["company-b", "Beta"],
  ["company-c", "Gamma"],
]);
const opportunities = [
  {
    id: "deal-a",
    company_id: "company-a",
    title: "Alpha rollout",
    value: 40_000,
    pipeline_stage: "proposal",
    win_outlook: "likely",
    next_action: "Send final proposal",
    next_action_due_at: "2026-08-23T12:00:00Z",
    next_action_owner: "us",
    updated_at: "2026-08-22T12:00:00Z",
  },
  {
    id: "deal-b",
    company_id: "company-b",
    title: "Beta pilot",
    value: 20_000,
    pipeline_stage: "discovery",
    win_outlook: "at_risk",
    next_action: "Wait for buyer decision",
    next_action_due_at: "2026-08-22T12:00:00Z",
    next_action_owner: "buyer",
    updated_at: "2026-08-21T12:00:00Z",
  },
  {
    id: "deal-c",
    company_id: "company-c",
    title: "Gamma discovery",
    value: null,
    pipeline_stage: "new",
    win_outlook: "not_assessed",
    next_action: null,
    next_action_due_at: null,
    next_action_owner: "us",
    updated_at: "2026-08-20T12:00:00Z",
  },
];

const { summary, items } = buildWorkPipeline({
  opportunities,
  companyName,
  nowMs,
  endTodayMs: Date.parse("2026-08-24T23:00:00Z"),
});

assert.equal(summary.totalDeals, 3);
assert.equal(summary.totalValue, 60_000);
assert.equal(summary.overdue, 1, "Buyer-owned waiting actions are not overdue work");
assert.equal(summary.atRisk, 1);
assert.equal(summary.missingNextAction, 1);
assert.equal(summary.deals[0].id, "deal-a", "The overdue deal is first");
assert.equal(summary.stages.find((stage) => stage.key === "proposal")?.value, 40_000);
assert.equal(items.length, 3);

const route = read("app/api/crm/inbox/route.ts");
const page = read("app/crm/inbox/page.tsx");
const lane = read("components/crm/SalesPipelineLane.tsx");

assert.match(route, /loadVisibleOpportunities<any>\(account/);
assert.doesNotMatch(
  route,
  /from\("opportunities"\)/,
  "The Sales Desk must use the canonical opportunity privacy policy"
);
assert.match(route, /opportunity\.assigned_to_user_id === account\.userId/);
assert.match(route, /pipeline: pipelineBuild\.summary/);

assert.match(page, /\{ key: "revenue", label: "Pipeline" \}/);
assert.match(page, /item\.kind === "opportunity"/);
assert.match(
  page,
  /<SalesPipelineLane[\s\S]*<OutreachTodayLane/,
  "Active deals must be part of the default sales flow before new outreach"
);
assert.match(page, /sourceChannel: "sales_desk_pipeline"/);

assert.match(lane, /Move active deals before finding more leads/);
assert.match(lane, /Table and Kanban/);
assert.match(lane, /Pipeline stage for/);
assert.match(lane, /Complete move and set next/);
assert.match(lane, /contentVisibility: "auto"/);
assert.doesNotMatch(
  lane,
  /crmFetch|supabaseAdmin/,
  "The pipeline lane reuses the Sales Desk response without another fetch"
);

console.log("Sales Desk pipeline core checks passed");
