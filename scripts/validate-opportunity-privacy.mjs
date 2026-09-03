import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canReadOpportunity,
  filterVisibleOpportunities,
} from "../lib/opportunity-access-policy.ts";
import { opportunityMatchesOwner } from "../lib/opportunity-owner-filter.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const workspace = "11111111-1111-4111-8111-111111111111";
const otherWorkspace = "22222222-2222-4222-8222-222222222222";
const lee = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jimmy = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const manager = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const safeCompany = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const confidentialCompany = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const scope = (userId, role) => ({ userId, role, workspaceId: workspace });
const row = (overrides = {}) => ({
  id: crypto.randomUUID(),
  workspace_id: workspace,
  owner_id: lee,
  visibility: "private",
  opportunity_type: "revenue",
  assigned_to_user_id: lee,
  company_id: safeCompany,
  ...overrides,
});
const safeCompanies = new Set([safeCompany]);

const privateRows = [
  row({ opportunity_type: "investment" }),
  row({ opportunity_type: "internal" }),
  row({ opportunity_type: "strategic" }),
];
assert.equal(
  filterVisibleOpportunities(scope(lee, "owner"), privateRows, safeCompanies).length,
  3,
  "The workspace owner retains the complete private portfolio"
);
assert.equal(
  filterVisibleOpportunities(scope(jimmy, "sales"), privateRows, safeCompanies).length,
  0,
  "A salesperson cannot receive another owner's non-revenue work"
);
assert.equal(
  canReadOpportunity(
    scope(jimmy, "sales"),
    row({
      opportunity_type: "investment",
      visibility: "team",
      assigned_to_user_id: jimmy,
    }),
    safeCompanies
  ),
  false,
  "Even a malformed team-visible investment row must fail closed"
);
assert.equal(
  canReadOpportunity(
    scope(jimmy, "sales"),
    row({ visibility: "team", assigned_to_user_id: jimmy }),
    safeCompanies
  ),
  true,
  "An explicitly assigned, non-confidential revenue deal is visible"
);
assert.equal(
  canReadOpportunity(
    scope(jimmy, "sales"),
    row({
      visibility: "team",
      assigned_to_user_id: jimmy,
      company_id: confidentialCompany,
    }),
    safeCompanies
  ),
  false,
  "A confidential company's deal is not exposed despite a stale assignment"
);
assert.equal(
  canReadOpportunity(
    scope(jimmy, "sales"),
    row({
      owner_id: jimmy,
      assigned_to_user_id: jimmy,
      opportunity_type: "internal",
    }),
    safeCompanies
  ),
  true,
  "A salesperson can still see their own private work"
);
assert.equal(
  canReadOpportunity(
    scope(manager, "manager"),
    row({ visibility: "team", assigned_to_user_id: jimmy }),
    safeCompanies
  ),
  false,
  "A manager does not inherit the workspace owner's unrestricted view"
);
assert.equal(
  canReadOpportunity(
    scope(lee, "owner"),
    row({ workspace_id: otherWorkspace }),
    safeCompanies
  ),
  false,
  "The owner boundary never crosses workspaces"
);

assert.equal(opportunityMatchesOwner({ assigned_to_user_id: lee }, jimmy, lee), false);
assert.equal(opportunityMatchesOwner({ assigned_to_user_id: jimmy }, jimmy, lee), true);
assert.equal(opportunityMatchesOwner({ assigned_to_user_id: null }, "unassigned", lee), true);

const accessHelper = read("lib/opportunity-access.ts");
const revenueRoute = read("app/api/crm/revenue/route.ts");
const opportunityList = read("app/api/crm/opportunities/route.ts");
const opportunityBoard = read("app/api/crm/opportunities/board/route.ts");
const opportunityRoute = read("app/api/crm/opportunities/[id]/route.ts");
const eventsRoute = read("app/api/crm/opportunities/[id]/events/route.ts");
const revenuePage = read("app/crm/revenue/page.tsx");
const searchRoute = read("app/api/crm/search/route.ts");
const healthRoute = read("app/api/crm/health/route.ts");
const migration = read(
  "supabase/migrations/20260824154422_enforce_owner_only_non_revenue_opportunities.sql"
);

assert.match(accessHelper, /loadVisibleOpportunities/);
assert.match(accessHelper, /scope\.role === "owner"/);
assert.match(accessHelper, /\.eq\("assigned_to_user_id", scope\.userId\)/);
assert.match(accessHelper, /\.eq\("is_confidential", false\)/);
assert.match(revenueRoute, /loadVisibleOpportunities\(account/);
assert.doesNotMatch(
  revenueRoute,
  /from\("opportunities"\)\.select\("\*"\)/,
  "The revenue endpoint must not load the unscoped opportunity table"
);
assert.match(opportunityList, /loadVisibleOpportunities\(scope/);
assert.match(opportunityBoard, /loadVisibleOpportunities\(accountScope/);
assert.match(opportunityRoute, /loadVisibleOpportunityById/);
assert.match(opportunityRoute, /resultingOpportunityType !== "revenue"/);
assert.match(opportunityRoute, /patch\.visibility = "private"/);
assert.match(eventsRoute, /requireRequestScope\(\)/);
assert.match(eventsRoute, /loadVisibleOpportunityById/);
assert.doesNotMatch(eventsRoute, /changes,evidence/);
assert.match(revenuePage, /row\.opportunity_type !== "revenue" &&[\s\S]*opportunityMatchesOwner/);
assert.match(searchRoute, /requireRequestScope\(\)/);
assert.match(searchRoute, /loadVisibleOpportunities/);
assert.match(healthRoute, /requireWorkspaceOwner\(\)/);
assert.match(migration, /opportunities_non_revenue_owner_only_check/);
assert.match(migration, /assigned_to_user_id = owner_id/);
assert.match(migration, /forecast_category = 'omitted'/);

console.log("Opportunity privacy and Jimmy owner-filter validation passed");
