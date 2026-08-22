import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hasSavedOutreachResearch,
  isUntouchedOutreachAssignment,
} from "../lib/outreach-assignment.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const allocationPage = read("app/settings/team/sharing/page.tsx");
const allocationApi = read("app/api/crm/team/sharing/route.ts");
const bulkAssignmentApi = read("app/api/crm/outreach/assign/route.ts");

assert.equal(hasSavedOutreachResearch(null), false);
assert.equal(hasSavedOutreachResearch({}), false);
assert.equal(hasSavedOutreachResearch([]), false);
assert.equal(hasSavedOutreachResearch({ summary: "saved" }), true);
assert.equal(
  isUntouchedOutreachAssignment({ status: "imported", research: {} }),
  true
);
assert.equal(
  isUntouchedOutreachAssignment(
    { status: "imported", research: {} },
    { hasMessage: true }
  ),
  false
);
assert.equal(
  isUntouchedOutreachAssignment({
    status: "imported",
    research: { summary: "saved" },
  }),
  false
);
assert.equal(
  isUntouchedOutreachAssignment({
    status: "contacted",
    research: null,
  }),
  false
);

assert.match(allocationApi, /requireWorkspaceOwner\(\)/);
assert.match(allocationApi, /isUntouchedOutreachAssignment/);
assert.match(allocationApi, /outreachAssignable/);
assert.match(allocationApi, /workload:/);
assert.match(allocationApi, /set_team_client_sales_assignment_service/);
assert.doesNotMatch(
  allocationApi.match(/return NextResponse\.json\([\s\S]*?\{ headers:/)?.[0] || "",
  /public_profile|company_linkedin_url|person_linkedin_url|last_reply_text/,
  "The owner allocation response must stay operational and concise"
);

assert.match(allocationPage, /Sales work allocation/);
assert.match(allocationPage, /Team workload/);
assert.match(allocationPage, /Ready to allocate/);
assert.match(allocationPage, /Client sharing/);
assert.match(allocationPage, /\/api\/crm\/outreach\/assign/);
assert.match(allocationPage, /Nothing was researched or emailed/);
assert.match(allocationPage, /owner Brain memory never move/);
assert.match(bulkAssignmentApi, /isUntouchedOutreachAssignment/);
assert.match(bulkAssignmentApi, /Only untouched imported prospects/);

console.log("Team sales work allocation checks passed");
