import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  brainSharedClientIds,
  isLimitedBrainScope,
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
const manager = {
  userId: "00000000-0000-4000-8000-000000000003",
  role: "manager",
};
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
assert.equal(isLimitedBrainScope(jimmy), true);

const managerView = partitionBrainOutreach(
  [
    ...rows,
    { id: "manager", assigned_to_user_id: manager.userId },
  ],
  manager
);
assert.deepEqual(
  managerView.actionable.map((row) => row.id),
  ["manager"]
);
assert.equal(personalOutreachSenderId(manager), manager.userId);
assert.equal(isLimitedBrainScope(manager), true);

const ownerView = partitionBrainOutreach(rows, {
  userId: lee,
  role: "owner",
});
assert.deepEqual(
  ownerView.actionable.map((row) => row.id),
  ["jimmy", "unassigned", "lee"]
);
assert.equal(personalOutreachSenderId({ userId: lee, role: "owner" }), null);
assert.equal(isLimitedBrainScope({ userId: lee, role: "owner" }), false);

const shares = [
  {
    company_id: "jimmy-client",
    status: "active",
    assigned_to_user_id: jimmy.userId,
  },
  {
    company_id: "manager-client",
    status: "active",
    assigned_to_user_id: manager.userId,
  },
  {
    company_id: "revoked-client",
    status: "revoked",
    assigned_to_user_id: jimmy.userId,
  },
];
assert.deepEqual(brainSharedClientIds(shares, jimmy), ["jimmy-client"]);
assert.deepEqual(brainSharedClientIds(shares, manager), ["manager-client"]);
assert.deepEqual(
  brainSharedClientIds(shares, { userId: lee, role: "owner" }),
  ["jimmy-client", "manager-client"]
);

const context = read("lib/crm-context.ts");
const assistant = read("app/api/crm/assistant/route.ts");
const transcripts = read("lib/call-transcript-context.ts");
const documents = read("lib/document-context.ts");

assert.match(context, /assigned_to_user_id/);
assert.match(context, /partitionBrainOutreach/);
assert.match(context, /sender_user_id/);
assert.match(context, /prospectsQuery = prospectsQuery\.eq\([\s\S]*?"assigned_to_user_id"/);
assert.match(context, /Other people's assigned prospects and reply details were not loaded/);
assert.match(context, /PERSONAL OUTREACH QUEUE/);
assert.match(context, /WORKSPACE AVAILABILITY/);
assert.match(context, /brainSharedClientIds/);
assert.doesNotMatch(context, /activeSharedClientIds/);
assert.match(context, /No client profiles are owned by or explicitly assigned/);
assert.match(assistant, /Only the verified workspace owner has the full Brain view/);
assert.match(assistant, /even if the member names the person or directly asks/);
assert.match(assistant, /assigned_to_user_id/);
assert.match(transcripts, /requestScope\.role !== "owner"/);
assert.match(transcripts, /transcriptQuery = transcriptQuery\.eq\([\s\S]*?"owner_id"/);
assert.match(documents, /requestScope\.role !== "owner"/);
assert.match(documents, /jobsQuery = jobsQuery\.eq\("owner_id"/);
assert.doesNotMatch(
  assistant,
  /You know ALL their clients and their whole pipeline/
);

console.log("Owner-only full Brain access checks passed");
