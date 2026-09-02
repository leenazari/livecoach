import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const itemType = read("lib/work-inbox.ts");
const inbox = read("app/api/crm/inbox/route.ts");
const lane = read("components/crm/OutreachTodayLane.tsx");
const draft = read("app/api/crm/outreach/replies/[id]/draft/route.ts");
const draftEngine = read("lib/outreach-positive-reply.ts");
const edit = read("app/api/crm/outreach/messages/[id]/route.ts");
const rehearse = read("app/api/crm/outreach/messages/[id]/rehearse/route.ts");
const sender = read("lib/outreach-send-queue.ts");

// The Work Inbox exposes only the already stored reply, previous email and
// existing booking draft. This is one canonical read, not another AI summary.
for (const field of [
  "prospectId",
  "messageId",
  "draftSubject",
  "draftBody",
  "replyText",
  "lastReplyAt",
  "previousSubject",
  "previousBody",
  "previousSentAt",
]) {
  assert.match(itemType, new RegExp(`\\b${field}\\b`));
}
assert.match(inbox, /last_reply_text/);
assert.match(inbox, /previousSentByProspect/);
assert.match(inbox, /kind: isReply \? "reply" : "outreach"/);
assert.match(inbox, /outreach: replyContext\(prospect\)/);
assert.match(inbox, /handledReplyProspects\.add\(message\.prospect_id\)[\s\S]*?continue/);

// The focused Sales Desk handles one positive reply before cold outreach and
// shows the evidence needed to answer without opening the legacy workspace.
assert.match(lane, /const focusedReply = actionableReplies\[0\]/);
assert.match(lane, /First action · buyer reply/);
assert.match(lane, /Their reply/);
assert.match(lane, /Your previous email/);
assert.match(lane, /Respond now/);
assert.match(lane, /Prepare booking reply/);
assert.match(lane, /Exact reply awaiting approval/);
assert.match(lane, /Approve reply \+ queue/);
assert.match(lane, /Up next replies/);

// The existing safe machinery remains the only delivery path. A dated action
// is recorded before the approved reply enters the five minute sender queue.
const actionCall = lane.indexOf(`/api/crm/outreach/\${item.sourceId}/next-action`);
const sendCall = lane.indexOf(
  `/api/crm/outreach/messages/\${message.id}/send`,
  actionCall
);
assert.ok(actionCall >= 0 && sendCall > actionCall);
assert.match(lane, /Send test to me/);
assert.match(sender, /OUTREACH_SEND_SPACING_MINUTES = 5/);
assert.match(sender, /prospect\.reply_category !== "interested"/);

// Every reply and draft route fails closed to the signed in workspace and
// salesperson. Raw IDs alone are never enough to access another user's data.
for (const source of [edit, rehearse, sender]) {
  assert.match(source, /\.eq\("workspace_id", sender\.workspaceId\)/);
  assert.match(source, /\.eq\("sender_user_id", sender\.userId\)|\.eq\("assigned_to_user_id", sender\.userId\)/);
}
assert.match(draft, /requireRequestScope\(\)/);
assert.match(draft, /preparePositiveReplyForApproval\(scope, params\.id\)/);
assert.match(draftEngine, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(draftEngine, /\.eq\("assigned_to_user_id", scope\.userId\)/);
assert.match(draftEngine, /sender_user_id: scope\.userId/);
assert.match(draftEngine, /owner_id: scope\.userId/);
assert.match(draftEngine, /visibility: "team"/);
assert.match(draftEngine, /\["draft", "approved", "failed"\]\.includes\(existingReply\.status\)/);
assert.match(draftEngine, /reused: true/);

console.log("Reply to meeting flow checks passed");
