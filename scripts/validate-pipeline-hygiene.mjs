import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const assistant = read("app/api/crm/assistant/route.ts");
const companyRoute = read("app/api/crm/companies/[id]/route.ts");
const synthesisRoute = read("app/api/crm/companies/[id]/synthesize/route.ts");
const updateProfileRoute = read("app/api/crm/update-profile/route.ts");
const exclusionHelper = read("lib/company-pipeline-exclusion.ts");
const canonicalHelper = read("lib/canonical-opportunity.ts");
const opportunityRoute = read("app/api/crm/opportunities/[id]/route.ts");
const taskBulkRoute = read("app/api/crm/tasks/bulk/route.ts");
const salesLane = read("components/crm/SalesPipelineLane.tsx");
const pipeline = read("components/crm/PipelineWorkspace.tsx");
const tasks = read("components/crm/TaskList.tsx");
const commitments = read("components/crm/Commitments.tsx");
const inboxPage = read("app/crm/inbox/page.tsx");
const scopedHistoryMigration = read(
  "supabase/migrations/20260827183000_scope_opportunity_history_events.sql"
);

// A confirmed Brain relationship change can explicitly reconcile stale deals,
// but changing a company to Partner alone never erases a genuine opportunity.
assert.match(assistant, /"removeFromPipeline":true/);
assert.match(assistant, /partner can still have a genuine expansion deal/);
assert.match(companyRoute, /body\.removeFromPipeline === true/);
assert.match(companyRoute, /\.eq\("opportunity_type", "revenue"\)/);
assert.match(companyRoute, /status: "dismissed"/);
assert.match(companyRoute, /last_change_context/);
assert.match(companyRoute, /preserves? the client|immutable history|history remain/i);
assert.match(companyRoute, /withCompanyPipelineExclusion/);
assert.match(exclusionHelper, /pipeline_exclusion/);
assert.match(exclusionHelper, /companyPipelineExclusionIds/);
assert.match(canonicalHelper, /createCanonicalOpenRevenueOpportunity/);
assert.match(synthesisRoute, /activeCompanyPipelineExclusion/);
assert.match(synthesisRoute, /opportunities\.length && !pipelineExclusion/);
assert.match(updateProfileRoute, /activeCompanyPipelineExclusion/);
assert.match(updateProfileRoute, /opportunities\.length && !pipelineExclusion/);

// Pipeline removal is recoverable and uses the canonical opportunity route.
assert.match(opportunityRoute, /"dismissed"/);
assert.match(salesLane, /Remove from pipeline/);
assert.match(salesLane, /history stay saved/);
assert.match(inboxPage, /status: "dismissed"/);
assert.match(pipeline, /onDismiss/);
assert.match(pipeline, /Keep the history, remove this active deal/);

// Repeated company names are grouped in Sales Today and explained as distinct
// deal threads in the detailed pipeline.
assert.match(salesLane, /const companyGroups = useMemo/);
assert.match(salesLane, /distinct deal threads/);
assert.match(pipeline, /repeated client name means that client has separate deal threads/i);

// Evidence editing opens in one responsive workspace instead of expanding
// inside a narrow table cell or Kanban card.
assert.match(pipeline, /aria-haspopup="dialog"/);
assert.match(pipeline, /role="dialog"/);
assert.match(pipeline, /Deal workspace/);
assert.match(pipeline, /sm:w-\[min\(960px,calc\(100vw-2rem\)\)\]/);
assert.match(pipeline, /createPortal/);
assert.equal(
  (pipeline.match(/<DealDetails/g) || []).length,
  1,
  "The full evidence editor must render only in the responsive deal workspace"
);

// Bulk cleanup stays bounded to the current workspace and owner, and archives
// rather than hard-deleting rows.
assert.match(taskBulkRoute, /slice\(0, 300\)/);
assert.match(taskBulkRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(taskBulkRoute, /\.eq\("owner_id", account\.userId\)/);
assert.match(taskBulkRoute, /status: "dismissed"/);
assert.doesNotMatch(taskBulkRoute, /\.delete\(/);
assert.match(tasks, /allowBulk/);
assert.match(tasks, /Select all/);
assert.match(commitments, /allowBulk/);
assert.match(commitments, /Select all/);
assert.match(inboxPage, /dismissSelectedWork/);
assert.match(inboxPage, /const selectableWorkTasks = filtered\.filter/);

// Immutable history created by the opportunity trigger must carry the same
// owner and workspace scope as its canonical deal. Otherwise multi-user
// isolation rejects the edit and the old value reappears after refresh.
assert.match(
  scopedHistoryMigration,
  /workspace_id, owner_id, visibility/
);
assert.match(
  scopedHistoryMigration,
  /new\.workspace_id, new\.owner_id, coalesce\(new\.visibility, 'private'\)/
);

// Manual activity logging supports the requested in-person path.
assert.match(salesLane, /\["in_person", "Face to face"\]/);

console.log("Pipeline hygiene, partner propagation and bulk cleanup checks passed");
