import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createOutreachSequenceStep,
  defaultOutreachSequence,
  moveOutreachSequenceStep,
  outreachSequenceValidationError,
  sanitizeOutreachSequence,
} from "../lib/outreach-sequence.ts";

const defaults = defaultOutreachSequence();
assert.equal(defaults.length, 3, "new campaigns start with three useful steps");
assert.equal(defaults[0].step, 1);
assert.equal(defaults[0].delayDays, 0);
assert.equal(defaults[2].delayDays, 7);
assert.ok(defaults.every((step) => step.channel === "email"));

const moved = moveOutreachSequenceStep(defaults, 2, 0);
assert.equal(moved[0].contentType, "close_loop");
assert.deepEqual(moved.map((step) => step.step), [1, 2, 3]);
assert.equal(moved[0].delayDays, 0, "the first visual step never waits");

const video = createOutreachSequenceStep("video", 3);
assert.equal(video.contentType, "video");
assert.match(video.purpose, /value/i);

assert.match(
  outreachSequenceValidationError([
    defaults[0],
    { ...defaults[1], delayDays: 0 },
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
assert.match(component, /LinkedIn actions will use the same builder/);

for (const route of [updateRoute, createRoute]) {
  assert.match(route, /requireRequestScope/);
  assert.match(route, /sanitizeOutreachSequence/);
  assert.match(route, /owner.*manager|manager.*owner/s);
}
assert.match(updateRoute, /eq\("workspace_id", account\.workspaceId\)/);
assert.match(createRoute, /workspace_id: account\.workspaceId/);

console.log("Campaign sequence builder validation passed");
