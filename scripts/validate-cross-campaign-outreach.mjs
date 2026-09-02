import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const queue = read("app/api/crm/outreach/queue/route.ts");
const prospects = read("app/api/crm/outreach/route.ts");
const page = read("app/crm/outreach/page.tsx");
const today = read("components/crm/OutreachTodayLane.tsx");
const queueCopySource = read("lib/outreach-campaign-queue-copy.ts");

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
assert.match(page, /Today’s assigned contacts/);
assert.match(page, /Filtering only changes what you can see and action/);
assert.match(page, /Campaign to add next/);
assert.match(page, /Campaign · \{row\.campaign\?\.name/);
assert.match(page, /Today · \{campaign\.count\} · \{campaign\.name\}/);
assert.match(page, /Selected for new spaces/);
assert.match(today, /Campaign · \{row\.campaign\.name\}/);
assert.match(queueCopySource, /Those contacts stay in their original campaigns/);
assert.match(queueCopySource, /will only supply a new contact after a space opens/);
assert.match(page, /const dailyQueueLimit = clampOutreachDailyLimit/);
assert.match(page, /queue\.length >= dailyQueueLimit/);
assert.match(page, /useState<ProspectSort>\("priority"\)/);
assert.match(page, /return \{ key: "warm", label: "Warm lead" \}/);

const queueCopy = await import("../lib/outreach-campaign-queue-copy.ts");
const recruitmentQueue = Array.from({ length: 50 }, () => ({
  campaign_id: "recruitment",
  campaign: { id: "recruitment", name: "Interviewa recruitment leaders" },
}));
const counts = queueCopy.outreachQueueCampaignCounts(recruitmentQueue);
assert.equal(
  queueCopy.filterOutreachQueueByCampaign(recruitmentQueue, "all").length,
  50
);
assert.equal(
  queueCopy.filterOutreachQueueByCampaign(recruitmentQueue, "workable").length,
  0
);
assert.deepEqual(counts, [
  {
    id: "recruitment",
    name: "Interviewa recruitment leaders",
    count: 50,
  },
]);
assert.equal(
  queueCopy.explainOutreachCampaignSelection({
    selectedCampaignName: "Workable",
    selectedCampaignId: "workable",
    queueCampaigns: counts,
    queueLength: 50,
    dailyLimit: 50,
  }),
  "Today’s queue is full with 50 Interviewa recruitment leaders contacts. Those contacts stay in their original campaigns. Workable will only supply a new contact after a space opens."
);
assert.equal(
  queueCopy.explainOutreachCampaignSelection({
    selectedCampaignName: "Workable",
    selectedCampaignId: "workable",
    queueCampaigns: queueCopy.outreachQueueCampaignCounts([
      ...recruitmentQueue.slice(0, 3),
      ...Array.from({ length: 12 }, () => ({
        campaign_id: "workable",
        campaign: { id: "workable", name: "Workable" },
      })),
    ]),
    queueLength: 15,
    dailyLimit: 50,
  }),
  "Today’s queue currently has 12 Workable contacts, 3 Interviewa recruitment leaders contacts. Those contacts stay in their original campaigns. Workable will fill only the 35 open spaces."
);

console.log("Cross campaign outreach checks passed");
