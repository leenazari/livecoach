import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  filterOutreachQueueByCampaign,
  OUTREACH_QUEUE_ALL_CAMPAIGNS,
} from "../lib/outreach-campaign-queue-copy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(path.join(root, "app/crm/outreach/page.tsx"), "utf8");

const queue = [
  { id: "one", campaign_id: "workable", campaign: { id: "workable", name: "Workable" } },
  { id: "two", campaign_id: "leaders", campaign: { id: "leaders", name: "Recruitment Leaders" } },
  { id: "three", campaign_id: "workable", campaign: { id: "workable", name: "Workable" } },
];

assert.equal(
  filterOutreachQueueByCampaign(queue, OUTREACH_QUEUE_ALL_CAMPAIGNS),
  queue,
  "All campaigns should retain the original queue without copying it"
);
assert.deepEqual(
  filterOutreachQueueByCampaign(queue, "workable").map((row) => row.id),
  ["one", "three"],
  "An exact campaign filter should only return its own rows"
);
assert.deepEqual(
  filterOutreachQueueByCampaign(queue, "missing"),
  [],
  "A campaign with no queued contacts should render an empty filtered view"
);

assert.match(page, /aria-label="Filter today's queue by campaign"/);
assert.match(page, /Updates this list immediately\. No Search button is needed\./);
assert.match(page, /setQueueCampaignFilterId\(event\.target\.value\)/);
assert.match(page, /setQueueCampaignFilterId\(result\.selectedCampaignId\)/);
assert.match(page, /const visibleQueue = useMemo/);
assert.match(page, /const preparableEmailRows = visibleQueue\.filter/);
assert.match(page, /const approvalReadyRows = visibleQueue\.filter/);
assert.match(
  page,
  /filterOutreachQueueByCampaign\(\s*queue,\s*queueCampaignFilterId\s*\)\.filter\(queueRowNeedsPreparation\)/s,
  "Bulk preparation must exclude hidden campaigns"
);
assert.match(
  page,
  /filterOutreachQueueByCampaign\(\s*queue,\s*queueCampaignFilterId\s*\)\.filter\(hasApprovableEmail\)/s,
  "Bulk approval must exclude hidden campaigns"
);
assert.doesNotMatch(
  page,
  /<button[^>]*>Search<\/button>/,
  "The client-side campaign filter should not require a Search button"
);

console.log("Outreach campaign filter checks passed");
