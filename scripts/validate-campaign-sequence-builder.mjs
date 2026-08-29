import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createOutreachActionStep,
  createOutreachSequenceStep,
  defaultOutreachSequence,
  isManualOutreachSequenceStep,
  moveOutreachSequenceStep,
  OUTREACH_SEQUENCE_PRESETS,
  outreachSequencePreset,
  outreachSequenceStepAt,
  outreachSequenceValidationError,
  sanitizeOutreachSequence,
} from "../lib/outreach-sequence.ts";

const defaults = defaultOutreachSequence();
assert.equal(defaults.length, 1, "new campaigns start with one clear email step");
assert.equal(defaults[0].step, 1);
assert.equal(defaults[0].delayDays, 0);
assert.ok(defaults.every((step) => step.channel === "email"));

const concise = outreachSequencePreset("concise_three_touch");
assert.equal(concise.length, 3, "a longer sequence is an explicit choice");
assert.equal(concise[2].delayDays, 7);
const moved = moveOutreachSequenceStep(concise, 2, 0);
assert.equal(moved[0].contentType, "close_loop");
assert.deepEqual(moved.map((step) => step.step), [1, 2, 3]);
assert.equal(moved[0].delayDays, 0, "the first visual step never waits");

const video = createOutreachSequenceStep("video", 3);
assert.equal(video.contentType, "video");
assert.match(video.purpose, /value/i);

const linkedin = createOutreachActionStep("linkedin_connect", 1);
assert.equal(linkedin.channel, "linkedin");
assert.equal(linkedin.actionType, "linkedin_connect");
assert.equal(isManualOutreachSequenceStep(linkedin), true);
assert.ok(OUTREACH_SEQUENCE_PRESETS.length >= 5);
const linkedinPreset = outreachSequencePreset("linkedin_warm_up");
assert.ok(linkedinPreset.some((step) => step.channel === "linkedin"));
assert.equal(
  outreachSequenceStepAt(linkedinPreset, 1)?.actionType,
  "linkedin_view"
);

assert.match(
  outreachSequenceValidationError([
    defaults[0],
    { ...createOutreachSequenceStep("insight", 1), delayDays: 0 },
  ]) || "",
  /between 1 and 30/
);
assert.match(
  outreachSequenceValidationError([
    { ...defaults[0], assetUrl: "http://unsafe.example" },
  ]) || "",
  /https:\/\//
);

const sanitized = sanitizeOutreachSequence([
  {
    purpose: "  Relevant opening  ",
    delayDays: 12,
    contentType: "plain",
  },
  {
    purpose: "  Useful proof  ",
    delayDays: 4.7,
    contentType: "case_study",
    assetUrl: " https://example.com/proof ",
  },
]);
assert.equal(sanitized.error, null);
assert.deepEqual(
  sanitized.sequence.map((step) => ({
    step: step.step,
    channel: step.channel,
    delayDays: step.delayDays,
  })),
  [
    { step: 1, channel: "email", delayDays: 0 },
    { step: 2, channel: "email", delayDays: 5 },
  ]
);
assert.equal(sanitized.sequence[1].assetUrl, "https://example.com/proof");

const sanitisedManual = sanitizeOutreachSequence([
  {
    channel: "linkedin",
    actionType: "linkedin_message",
    purpose: "Send a personal message",
  },
  {
    channel: "phone",
    actionType: "manual_call",
    purpose: "Call and log the outcome",
    delayDays: 2,
  },
]);
assert.equal(sanitisedManual.error, null);
assert.equal(sanitisedManual.sequence[0].actionType, "linkedin_message");
assert.equal(sanitisedManual.sequence[1].channel, "phone");

const [page, component, updateRoute, createRoute] = await Promise.all([
  readFile(new URL("../app/crm/outreach/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../components/crm/CampaignSequenceBuilder.tsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../app/api/crm/outreach/campaigns/[id]/route.ts", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../app/api/crm/outreach/campaigns/route.ts", import.meta.url),
    "utf8"
  ),
]);

assert.match(page, /<CampaignSequenceBuilder/);
assert.match(component, /DndContext/);
assert.match(component, /sortableKeyboardCoordinates/);
assert.match(component, /Save sequence/);
assert.match(component, /LiveCoach automates only approved email delivery/);
assert.match(component, /Start with one clear email/);
assert.match(component, /Add the next step only if needed/);
assert.match(component, /Optional templates and reset/);
assert.match(component, /Start again with one email/);
assert.match(component, /never clicks, likes, connects, calls or sends/);
assert.match(page, /One campaign, three clear views/);
assert.match(page, /campaignEditorView/);
assert.match(page, /startCampaignTutorial/);
assert.match(page, /campaign-card-/);
assert.match(page, /data-sales-tour="campaign-sequence"/);

for (const route of [updateRoute, createRoute]) {
  assert.match(route, /requireRequestScope/);
  assert.match(route, /sanitizeOutreachSequence/);
  assert.match(route, /owner.*manager|manager.*owner/s);
}
assert.match(updateRoute, /eq\("workspace_id", account\.workspaceId\)/);
assert.match(createRoute, /workspace_id: account\.workspaceId/);

console.log("Campaign sequence builder validation passed");
