import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const revenueApi = read("app/api/crm/revenue/route.ts");
const portfolioApi = read("app/api/crm/clients/portfolio/route.ts");
const outreachApi = read("app/api/crm/outreach/route.ts");
const revenuePage = read("app/crm/revenue/page.tsx");
const pipeline = read("components/crm/PipelineWorkspace.tsx");
const portfolio = read("components/crm/ClientPortfolio.tsx");

for (const [name, source, userId] of [
  ["revenue", revenueApi, "account.userId"],
  ["client portfolio", portfolioApi, "scope.userId"],
  ["outreach", outreachApi, "account.userId"],
]) {
  assert.match(
    source,
    new RegExp(
      `if \\(!canManageAssignments\\) \\{[\\s\\S]*?membersQuery = membersQuery\\.eq\\(\"user_id\", ${userId.replaceAll(".", "\\.")}\\)`
    ),
    `${name} must query only the signed-in directory entry for a sales user`
  );
}

assert.match(
  revenuePage,
  /const activeOwnerFilter = data\?\.canManageAssignments[\s\S]*?: "mine"/,
  "A sales user cannot restore another owner's filter through stale client state"
);

assert.match(
  pipeline,
  /const effectiveOwnerFilter = canManageAssignments \? ownerFilter : "mine"/,
  "The pipeline must fail closed to the signed-in user's work"
);
assert.match(pipeline, /canManageAssignments \? \([\s\S]*?aria-label="Filter pipeline by deal owner"/);
assert.match(pipeline, />\s*My work only\s*<\/div>/);
assert.match(pipeline, /: "Another team member"/);

assert.match(
  portfolio,
  /const effectiveOwnerFilter = canManageAssignments \? ownerFilter : "mine"/,
  "The client list must fail closed to the signed-in user's work"
);
assert.match(portfolio, /canManageAssignments \? \([\s\S]*?aria-label="Filter clients by sales owner"/);
assert.match(portfolio, />\s*My clients only\s*<\/div>/);
assert.match(portfolio, /: "Another team member"/);

console.log("Sales directory isolation checks passed");
