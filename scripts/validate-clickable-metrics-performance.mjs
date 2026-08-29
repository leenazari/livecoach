import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const metric = read("components/crm/MetricDrilldown.tsx");
const revenue = read("app/crm/revenue/page.tsx");
const pipeline = read("components/crm/PipelineWorkspace.tsx");
const salesLane = read("components/crm/SalesPipelineLane.tsx");
const outreach = read("app/crm/outreach/page.tsx");
const metricsRoute = read("app/api/crm/outreach/metrics/route.ts");
const prospectsRoute = read("app/api/crm/outreach/route.ts");

// A summary metric is a navigation control, not decorative text. The shared
// primitive retains keyboard focus, a mobile target and an exact destination.
assert.match(metric, /min-h-16/);
assert.match(metric, /focus-visible:ring-2/);
assert.match(metric, /if \(href\)/);
assert.match(revenue, /chooseDrilldown/);
assert.match(revenue, /id="pipeline-records"/);
assert.match(revenue, /id="excluded-records"/);
assert.match(pipeline, /matchesPipelineFocus/);
assert.match(pipeline, /const changeFocus = props\.onFocusChange \?\? setLocalFocus/);
assert.match(salesLane, /\/crm\/revenue\?view=stage-/);

// Revisits use the signed-in browser session's last successful response, then
// refresh in the background. Heavy panels are split and long lists are bounded.
assert.match(outreach, /getCached/);
assert.match(outreach, /requestIdleCallback/);
assert.match(outreach, /const PROSPECT_PAGE_SIZE = 60/);
assert.match(outreach, /shown\.slice\(0, visibleProspectLimit\)/);
assert.match(outreach, /Load next \{Math\.min/);
assert.match(outreach, /dynamic\(\s*\(\) => import\("@\/components\/crm\/CampaignSequenceBuilder"\)/);

// The summary endpoint counts manual calls in the database. It must never pull
// an arbitrary history-sized row set just to calculate four numbers.
assert.doesNotMatch(metricsRoute, /limit\(10000\)/);
assert.match(metricsRoute, /manualCallsToday\.count/);
assert.match(metricsRoute, /connectedManualCalls\.count/);
assert.match(metricsRoute, /limit\(100\)/);

// Prospect lists return only the fields used by this view. Research is used for
// server scoring, reduced to a boolean for assignment safety, and not duplicated
// in the browser payload. Workspace and per-user boundaries remain mandatory.
assert.doesNotMatch(prospectsRoute, /\.from\("outreach_prospects"\)\s*\.select\("\*"\)/);
assert.match(prospectsRoute, /\.from\("outreach_prospects"\)\s*\.select\(PROSPECT_LIST_FIELDS\)/);
assert.match(prospectsRoute, /has_research: hasSavedResearch\(research\)/);
assert.match(prospectsRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(prospectsRoute, /assigned_to_user_id\.eq\.\$\{account\.userId\}/);

console.log("clickable metrics and CRM performance checks passed");
