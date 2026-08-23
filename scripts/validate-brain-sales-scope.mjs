import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  partitionBrainOutreach,
  personalOutreachSenderId,
} from "../lib/brain-sales-scope.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const jimmy = {
  userId: "00000000-0000-4000-8000-000000000002",
  role: "sales",
};
const lee = "00000000-0000-4000-8000-000000000001";
const rows = [
  { id: "jimmy", assigned_to_user_id: jimmy.userId },
  { id: "unassigned", assigned_to_user_id: null },
  { id: "lee", assigned_to_user_id: lee },
];

const salespersonView = partitionBrainOutreach(rows, jimmy);
assert.deepEqual(
  salespersonView.actionable.map((row) => row.id),
  ["jimmy"]
);
assert.deepEqual(
  salespersonView.claimable.map((row) => row.id),
  ["unassigned"]
);
assert.deepEqual(
  salespersonView.assignedToOthers.map((row) => row.id),
  ["lee"]
);
assert.equal(personalOutreachSenderId(jimmy), jimmy.userId);

const ownerView = partitionBrainOutreach(rows, {
  userId: lee,
  role: "owner",
});
assert.deepEqual(
  ownerView.actionable.map((row) => row.id),
  ["jimmy", "unassigned", "lee"]
);
assert.equal(personalOutreachSenderId({ userId: lee, role: "owner" }), null);

const context = read("lib/crm-context.ts");
const assistant = read("app/api/crm/assistant/route.ts");

assert.match(context, /assigned_to_user_id/);
assert.match(context, /partitionBrainOutreach/);
assert.match(context, /sender_user_id/);
assert.match(context, /prospectsQuery = prospectsQuery\.eq\([\s\S]*?"assigned_to_user_id"/);
assert.match(context, /Other teammates' assigned prospects and reply details were not loaded/);
assert.match(context, /PERSONAL OUTREACH QUEUE/);
assert.match(context, /WORKSPACE AVAILABILITY/);
assert.match(context, /No client profiles are assigned or safely shared/);
assert.match(assistant, /another teammate's prospects/);
assert.match(assistant, /Treat unassigned outreach prospects only as available to claim/);
assert.doesNotMatch(
  assistant,
  /You know ALL their clients and their whole pipeline/
);

console.log("Brain salesperson action-scope checks passed");
