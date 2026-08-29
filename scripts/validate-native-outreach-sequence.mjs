import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  prepareRoute,
  manualActionRoute,
  campaignRoute,
  queueRoute,
  page,
  salesToday,
  manualCallRoute,
] = await Promise.all([
  readFile(
    new URL("../app/api/crm/outreach/[id]/prepare/route.ts", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL(
      "../app/api/crm/outreach/[id]/sequence-action/route.ts",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL("../app/api/crm/outreach/campaigns/route.ts", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../app/api/crm/outreach/queue/route.ts", import.meta.url),
    "utf8"
  ),
  readFile(new URL("../app/crm/outreach/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../components/crm/OutreachTodayLane.tsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../app/api/crm/outreach/[id]/manual-call/route.ts", import.meta.url),
    "utf8"
  ),
]);

assert.match(prepareRoute, /Complete this manual sequence step from Today/);
assert.match(prepareRoute, /sequenceStep\.channel \|\| "email"/);

for (const source of [manualActionRoute, campaignRoute, queueRoute]) {
  assert.match(source, /workspace_id/);
}
assert.match(manualActionRoute, /assigned_to_user_id !== account\.userId/);
assert.match(manualActionRoute, /owner_id", account\.userId/);
assert.match(manualActionRoute, /eq\("current_step", currentStep\)/);
assert.match(manualActionRoute, /manual_sequence_step_completed/);
assert.match(manualActionRoute, /step\?\.channel !== "linkedin"/);
assert.doesNotMatch(manualActionRoute, /sendConnectedOutreachMail|fetch\(/);

assert.match(campaignRoute, /loadPersonalCampaignStats/);
assert.match(campaignRoute, /eq\("sender_user_id", userId\)/);
assert.match(campaignRoute, /eq\("owner_id", userId\)/);
assert.match(campaignRoute, /statsScope: "personal"/);

assert.match(queueRoute, /sequenceStepDue/);
assert.match(queueRoute, /queueKind: isFollowUp \? "follow_up" : "new_contact"/);
assert.match(queueRoute, /previousContact: lastSentMessage/);
const firstTouchSelection = queueRoute.indexOf(
  "First touches fill today's available slots before due follow ups."
);
const followUpSelection = queueRoute.indexOf(
  "Due follow ups use only capacity left after the first touch wave."
);
assert.ok(firstTouchSelection >= 0);
assert.ok(followUpSelection > firstTouchSelection);
assert.match(page, /Your results only/);
assert.match(page, /data confidence/);
assert.match(page, /Earlier email sent/);
assert.match(page, /This is a scheduled follow up, not a new prospect/);
assert.match(page, /Step one is prioritised across the active campaign/);
assert.match(page, /queueWaveRank/);
assert.match(salesToday, /queueWaveRank/);
assert.match(page, /Open LinkedIn/);
assert.match(page, /Mark .* done/);
assert.match(page, /SendPilot handoffs and manual actions are confirmed one person at a time/);
assert.match(page, /\(row\.sequenceStep\?\.channel \|\| "email"\) === "email"/);

assert.match(manualCallRoute, /currentStep\.actionType === "manual_call"/);
assert.match(manualCallRoute, /\["voicemail", "no_answer"\]/);
assert.match(manualCallRoute, /eq\("owner_id", account\.userId\)/);

console.log("Native multi-channel outreach sequence validation passed");
