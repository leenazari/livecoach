import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const clientRoute = read("app/api/crm/clients/portfolio/route.ts");
const clientPortfolio = read("components/crm/ClientPortfolio.tsx");
const revenueRoute = read("app/api/crm/revenue/route.ts");
const pipeline = read("components/crm/PipelineWorkspace.tsx");

// Both surfaces reuse their canonical database creation timestamp. The reads
// remain inside the existing signed-in workspace and row-visibility boundary.
assert.match(clientRoute, /requireRequestScope\(\)/);
assert.match(clientRoute, /created_at,updated_at/);
assert.match(clientRoute, /createdAt:\s*\n?\s*typeof company\.created_at/);
assert.match(clientPortfolio, /createdAt: string \| null/);
assert.match(clientPortfolio, /\["added", "Date added"\]/);
assert.match(clientPortfolio, /sort\.key === "added"/);
assert.match(clientPortfolio, /activityDate\(row\.createdAt\)/);

assert.match(revenueRoute, /requireRequestScope\(\)/);
assert.match(revenueRoute, /loadVisibleOpportunities\(account/);
assert.match(revenueRoute, /return \{\s*\.\.\.op,/);
assert.match(pipeline, /created_at: string \| null/);
assert.match(pipeline, /"priority" \| "newest" \| "oldest"/);
assert.match(pipeline, /Date added/);
assert.match(pipeline, /dateTime\(row\.created_at\)/);
assert.match(pipeline, /Restore priority order/);

console.log("Client and pipeline date-added checks passed");
