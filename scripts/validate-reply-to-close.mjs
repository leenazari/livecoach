import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const navigation = read("lib/crm-navigation.ts");
const notifications = read("app/api/crm/notifications/route.ts");
const taskList = read("components/crm/TaskList.tsx");
const taskDashboard = read("components/crm/TaskDashboard.tsx");
const resolveRoute = read("app/api/crm/outreach/replies/[id]/resolve/route.ts");
const replyAttention = read("lib/reply-attention.ts");
const metrics = read("app/api/crm/outreach/metrics/route.ts");
const outreachPage = read("app/crm/outreach/page.tsx");
const workInbox = read("app/api/crm/inbox/route.ts");
const followUp = read("app/api/crm/outreach/[id]/follow-up/route.ts");
const sendQueue = read("lib/outreach-send-queue.ts");
const emailMonitor = read("app/api/cron/important-email-monitor/route.ts");

// Every notification and task opens the exact reply. A generic Replies tab is
// not enough once more than one buyer has answered.
assert.match(navigation, /function outreachReplyHref/);
assert.match(navigation, /tab=replies&reply=\$\{id\}/);
assert.match(notifications, /kind === "outreach_reply"/);
assert.match(notifications, /source_table === "outreach_prospects"/);
assert.match(notifications, /outreachReplyHref\(row\.source_id\)/);
for (const taskUi of [taskList, taskDashboard]) {
  assert.match(taskUi, /outreachReplyHref/);
  assert.match(taskUi, /task\.kind === "reply_alert"|t\.kind === "reply_alert"/);
}

// IDs never grant authority by themselves. The signed in workspace and owner
// must match before an attention receipt can be completed.
assert.match(resolveRoute, /requireRequestScope\(\)/);
assert.match(resolveRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(resolveRoute, /\.eq\("assigned_to_user_id", account\.userId\)/);
assert.match(resolveRoute, /\.eq\("id", params\.id\)/);
assert.match(resolveRoute, /!prospect\?\.last_reply_at/);
assert.match(resolveRoute, /resolveReplyAttention/);

assert.match(replyAttention, /function resolveReplyAttention/);
assert.match(replyAttention, /\.eq\("workspace_id", input\.workspaceId\)/g);
assert.match(replyAttention, /\.eq\("owner_id", input\.userId\)/);
assert.match(replyAttention, /\.eq\("user_id", input\.userId\)/);
assert.match(replyAttention, /\.in\("kind", \["reply_alert", "email_alert"\]\)/);
assert.match(replyAttention, /\.contains\("payload", \{ outreachProspectId: input\.prospectId \}\)/);
assert.match(replyAttention, /\.eq\("source_id", input\.prospectId\)/);
assert.doesNotMatch(
  replyAttention,
  /from\("outreach_prospects"\)\s*\.update|from\("outreach_events"\)\s*\.update/,
  "Resolving attention must never overwrite the reply or immutable event history"
);

// The reply workspace is a canonical, owner-scoped read. It reuses stored
// reply evidence, the prior sent message, campaign and current attention task.
assert.match(metrics, /\.eq\("assigned_to_user_id", account\.userId\)/);
assert.match(metrics, /\.eq\("sender_user_id", account\.userId\)/g);
assert.match(metrics, /\.eq\("owner_id", account\.userId\)/g);
assert.match(metrics, /\.in\("prospect_id", replyProspectIds\)/);
assert.match(metrics, /previousMessage/);
assert.match(metrics, /replyEvidence/);
assert.match(metrics, /campaign:/);
assert.match(metrics, /attentionOpen:/);
assert.match(metrics, /\.in\("kind", \["reply_alert", "email_alert"\]\)/);

// Deep links focus the exact buyer and progressively disclose evidence. Every
// outcome has a useful next step without inventing new facts or reanalysing the
// reply with a model.
assert.match(outreachPage, /params\.get\("reply"\)/);
assert.match(outreachPage, /setFocusedReplyId\(requestedReply\)/);
assert.match(outreachPage, /id=\{`reply-\$\{reply\.id\}`\}/);
assert.match(outreachPage, /Reply to close/);
assert.match(outreachPage, /Their exact reply/);
assert.match(outreachPage, /Campaign and previous message/);
assert.match(outreachPage, /Recommended next move/);
assert.match(outreachPage, /Set dated follow up/);
assert.match(outreachPage, /I handled this elsewhere/);
assert.match(outreachPage, /original reply and campaign history are never deleted/i);
assert.match(outreachPage, /\/api\/crm\/outreach\/replies\/\$\{prospectId\}\/resolve/);

// Today shows one action surface for a positive reply. A precise completed
// receipt hides only that received event, so a later reply becomes actionable.
assert.match(workInbox, /positiveReplyProspectIds/);
assert.match(workInbox, /\["reply_alert", "email_alert"\]\.includes\(task\.kind\)/);
assert.match(workInbox, /resolvedReplyKeys/);
assert.match(workInbox, /`\$\{prospect\.id\}:\$\{prospect\.last_reply_at\}`/);
assert.match(workInbox, /outreachReplyHref\(prospect\.id\)/);

// A dated follow up clears the receipt immediately. A reply entering the send
// queue stays open until the provider confirms delivery.
assert.match(followUp, /resolveReplyAttention/);
const queueSection = sendQueue.slice(
  sendQueue.indexOf("export async function queueApprovedOutreachMessage"),
  sendQueue.indexOf("export async function dispatchDueOutreachMessage")
);
assert.doesNotMatch(queueSection, /resolveReplyAttention/);
assert.match(queueSection, /attentionPendingDelivery/);
assert.match(sendQueue, /sendConnectedOutreachMail[\s\S]*resolveReplyAttention/);
for (const source of [followUp, sendQueue]) {
  assert.match(source, /workspaceId:/);
  assert.match(source, /userId:/);
  assert.match(source, /prospectId:/);
}
assert.match(sendQueue, /message\.strategy\?\.messageType === "reply"/);
assert.match(emailMonitor, /outreach\.category === "interested" \|\| outreach\.outOfOffice/);
assert.match(emailMonitor, /ensureReplyAttentionTask/);

console.log("Reply to Close ownership and state transition checks passed");
