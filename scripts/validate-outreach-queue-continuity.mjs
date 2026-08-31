import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canResumeUnsentFirstTouch } from "../lib/outreach-queue-policy.ts";
import { isUuid } from "../lib/uuid.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const selectRoute = read("app/api/crm/outreach/campaigns/select/route.ts");
const queueRoute = read("app/api/crm/outreach/queue/route.ts");
const page = read("app/crm/outreach/page.tsx");

assert.equal(
  isUuid("317c8b4b-8e63-40c4-ae70-239af95042cf"),
  true,
  "A real Workable campaign UUID must pass validation"
);
assert.equal(isUuid("workable"), false);
assert.match(selectRoute, /isUuid\(campaignId\)/);

const base = {
  status: "queued",
  current_step: 1,
  last_sent_at: null,
};
assert.equal(canResumeUnsentFirstTouch({ ...base, queued_for: null }, "2026-08-31"), true);
assert.equal(canResumeUnsentFirstTouch({ ...base, queued_for: "2026-08-29" }, "2026-08-31"), true);
assert.equal(canResumeUnsentFirstTouch({ ...base, queued_for: "2026-08-31" }, "2026-08-31"), false);
assert.equal(canResumeUnsentFirstTouch({ ...base, queued_for: "2026-09-01" }, "2026-08-31"), false);
assert.equal(canResumeUnsentFirstTouch({ ...base, current_step: 2, queued_for: "2026-08-29" }, "2026-08-31"), false);
assert.equal(canResumeUnsentFirstTouch({ ...base, last_sent_at: "2026-08-29T10:00:00Z", queued_for: "2026-08-29" }, "2026-08-31"), false);
assert.equal(canResumeUnsentFirstTouch({ ...base, status: "replied", queued_for: "2026-08-29" }, "2026-08-31"), false);

assert.match(queueRoute, /canResumeUnsentFirstTouch\(existingEnrolment, today\)/);
assert.doesNotMatch(queueRoute, /!existingEnrolment\.queued_for/);
assert.match(page, /campaignId: selectedCampaign\.id/);
assert.match(page, /campaignId: activeCampaign\?\.id \|\| null/);
assert.match(page, /campaignId: result\.selectedCampaignId/);

console.log("Outreach queue continuity checks passed");
