import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const queue = read("app/api/crm/outreach/queue/route.ts");
const prospects = read("app/api/crm/outreach/route.ts");
const page = read("app/crm/outreach/page.tsx");

// Today reads one owner-scoped list across campaigns. The API still filters
// every row to the signed-in salesperson's assigned prospects.
assert.match(
  queue,
  /queue: await loadQueue\(account\.userId, account\.workspaceId\)/
);
assert.match(queue, /assigned_to_user_id === userId/);
assert.match(prospects, /messagesQuery = messagesQuery\.eq\("sender_user_id", account\.userId\)/);
assert.match(prospects, /enrolmentsQuery = enrolmentsQuery\.eq\("owner_id", account\.userId\)/);

// An individual prospect keeps its existing campaign. Preparing it cannot
// silently move it into whichever campaign the salesperson last selected.
assert.match(queue, /const requestedCampaignId = String\(body\.campaignId \|\| ""\)\.trim\(\)/);
assert.match(queue, /row\.id === requestedCampaignId && row\.status === "active"/);
assert.match(page, /const campaignIds = prospect\.outreach\?\.campaignIds \|\| \[\]/);
assert.match(page, /campaignId: targetCampaign\.id/);
assert.match(page, /This prospect's campaign is not active/);

// The combined list is the default and retains visible campaign identity.
assert.match(page, /useState\("all"\)/);
assert.match(page, /All campaigns is the combined priority list/);
assert.match(page, /membershipCampaigns\.map/);
assert.match(page, /Today’s combined queue/);
assert.match(page, /const dailyQueueLimit = Math\.min\(20,/);
assert.match(page, /queue\.length >= dailyQueueLimit/);
assert.match(page, /useState<ProspectSort>\("priority"\)/);
assert.match(page, /return \{ key: "warm", label: "Warm lead" \}/);

console.log("Cross campaign outreach checks passed");
