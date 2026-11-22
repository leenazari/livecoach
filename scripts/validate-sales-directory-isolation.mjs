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
      `if \\(!canManageAssignments(?: && !canCoverTeamLeads)?\\) \\{[\\s\\S]*?membersQuery = membersQuery\\.eq\\(\"user_id\", ${userId.replaceAll(".", "\\.")}\\)`
    ),
    `${name} must query only the signed-in directory entry unless owner-enabled team lead cover is verified`
  );
}

assert.match(
  revenuePage,
  /const activeOwnerFilter = \(data\?\.canManageAssignments \|\| data\?\.canCoverTeamLeads\)[\s\S]*?: "mine"/,
  "A sales user cannot restore another owner's filter through stale client state"
);

assert.match(
  pipeline,
  /const effectiveOwnerFilter = canViewTeam \? ownerFilter : "mine"/,
  "The pipeline must fail closed to the signed-in user's work"
);
assert.match(pipeline, /canViewTeam \? \([\s\S]*?aria-label="Filter pipeline by deal owner"/);
assert.match(pipeline, />\s*My work only\s*<\/div>/);
assert.match(pipeline, /: "Another team member"/);

assert.match(
  portfolio,
  /const effectiveOwnerFilter = canViewTeam \? ownerFilter : "mine"/,
  "The client list must fail closed to the signed-in user's work"
);
assert.match(portfolio, /canViewTeam \? \([\s\S]*?aria-label="Filter clients by sales owner"/);
assert.match(portfolio, />\s*My clients only\s*<\/div>/);
assert.match(portfolio, /: "Another team member"/);

assert.match(pipeline, /const canViewTeam = canManageAssignments \|\| props\.canCoverTeamLeads === true/);
assert.match(portfolio, /const canViewTeam = canManageAssignments \|\| canCoverTeamLeads/);
console.log("Sales directory isolation checks passed, including explicit team-cover gates");
