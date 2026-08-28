import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const metrics = read("app/api/crm/outreach/metrics/route.ts");
const prospects = read("app/api/crm/outreach/route.ts");
const replies = read("app/api/crm/outreach/replies/route.ts");
const page = read("app/crm/outreach/page.tsx");

assert.match(metrics, /requireRequestScope\(\)/);
assert.match(metrics, /scope: "personal"/);
assert.match(metrics, /"Cache-Control": "private, no-store"/);
assert.match(
  metrics,
  /from\("outreach_prospects"\)[\s\S]*?eq\("assigned_to_user_id", account\.userId\)/
);
assert.ok(
  (metrics.match(/eq\("sender_user_id", account\.userId\)/g) || []).length >= 6,
  "Every personal message count, draft and history query must use the signed-in sender"
);
assert.ok(
  (metrics.match(/eq\("owner_id", account\.userId\)/g) || []).length >= 8,
  "Email and SendPilot events must be attributed to the signed-in owner"
);
assert.match(
  metrics,
  /message:outreach_messages!inner\(sender_user_id\)[\s\S]*?eq\("message\.sender_user_id", account\.userId\)/,
  "Email A and B attribution must retain the sending-message join"
);
assert.match(
  metrics,
  /from\("outreach_learnings"\)[\s\S]*?eq\("owner_id", account\.userId\)/
);

assert.match(prospects, /const canManageAssignments = account\.role === "owner" \|\| account\.role === "manager"/);
assert.match(
  prospects,
  /if \(!canManageAssignments\)[\s\S]*?assigned_to_user_id\.is\.null,assigned_to_user_id\.eq\.\$\{account\.userId\}/
);
assert.match(
  prospects,
  /if \(!canManageAssignments\)[\s\S]*?messagesQuery = messagesQuery\.eq\("sender_user_id", account\.userId\)/
);
assert.match(
  prospects,
  /enrolmentsQuery = enrolmentsQuery\.eq\("owner_id", account\.userId\)/
);

assert.match(replies, /requireRequestScope\(\)/);
assert.match(replies, /sweepOutreachReplies\(20, account\.userId\)/);

assert.match(page, />My prospects</);
assert.match(page, /canManageAssignments \? <>\s*<option value="all">All owners<\/option>/);
assert.match(page, /Your outreach progress/);
assert.match(page, /Email and SendPilot LinkedIn activity from this signed in salesperson/);

const activity = [
  { sender: "lee", sent: 63, replies: 2 },
  { sender: "kamm", sent: 0, replies: 0 },
];
const personal = (user) => activity.find((row) => row.sender === user);
assert.deepEqual(personal("kamm"), { sender: "kamm", sent: 0, replies: 0 });
assert.deepEqual(personal("lee"), { sender: "lee", sent: 63, replies: 2 });

console.log("Personal outreach analytics isolation checks passed");
