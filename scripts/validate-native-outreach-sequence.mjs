import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  prepareRoute,
  manualActionRoute,
  campaignRoute,
  queueRoute,
  page,
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
assert.match(page, /Your results only/);
assert.match(page, /Open LinkedIn/);
assert.match(page, /Mark .* done/);
assert.match(page, /Manual actions must be confirmed one at a time/);
assert.match(page, /\(row\.sequenceStep\?\.channel \|\| "email"\) === "email"/);

assert.match(manualCallRoute, /currentStep\.actionType === "manual_call"/);
assert.match(manualCallRoute, /\["voicemail", "no_answer"\]/);
assert.match(manualCallRoute, /eq\("owner_id", account\.userId\)/);

console.log("Native multi-channel outreach sequence validation passed");
