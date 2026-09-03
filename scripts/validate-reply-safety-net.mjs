import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const sender = read("lib/outreach-send-queue.ts");
const attention = read("lib/reply-attention.ts");
const metrics = read("app/api/crm/outreach/metrics/route.ts");
const inbox = read("app/api/crm/inbox/route.ts");
const today = read("components/crm/OutreachTodayLane.tsx");
const outreachPage = read("app/crm/outreach/page.tsx");
const bookingHandoff = read("lib/outreach-crm.ts");

// Entering the paced queue is reversible and is not provider delivery. The
// reply alert must stay open until Gmail or Microsoft accepts the message.
const queueSection = sender.slice(
  sender.indexOf("export async function queueApprovedOutreachMessage"),
  sender.indexOf("export async function dispatchDueOutreachMessage")
);
assert.doesNotMatch(queueSection, /resolveReplyAttention/);
assert.match(queueSection, /attentionPendingDelivery: isReply/);
assert.match(queueSection, /attentionResolved: false/);

// Both pre-send guards and provider refusal restore the same owner's receipt.
const dispatchSection = sender.slice(
  sender.indexOf("export async function dispatchDueOutreachMessage")
);
assert.match(dispatchSection, /const isReply =[\s\S]*messageType === "reply"/);
assert.ok((dispatchSection.match(/reopenReplyAttention\(/g) || []).length >= 2);
assert.match(dispatchSection, /failureReason: reason/);
assert.match(dispatchSection, /failureReason: sent\.error/);

// A successful send becomes authoritative before attention is resolved. This
// ordering prevents an alert disappearing while delivery is still uncertain.
const providerSend = dispatchSection.indexOf("sendConnectedOutreachMail");
const sentWrite = dispatchSection.indexOf('status: "sent"', providerSend);
const deliveryCheck = dispatchSection.indexOf("deliveryWriteError", sentWrite);
const resolveAttention = dispatchSection.indexOf(
  "resolveReplyAttention",
  deliveryCheck
);
assert.ok(providerSend >= 0 && sentWrite > providerSend);
assert.ok(deliveryCheck > sentWrite && resolveAttention > deliveryCheck);
assert.match(dispatchSection, /replyReceivedAt/);
assert.match(dispatchSection, /messageId: message\.id/);

// Receipt operations are exact to workspace, user, prospect and inbound reply
// time. They never overwrite the canonical prospect or immutable event row.
assert.match(attention, /function reopenReplyAttention/);
assert.match(attention, /function resolveReplyAttention/);
assert.match(attention, /workspace_members/);
assert.match(attention, /\.eq\("workspace_id", input\.workspaceId\)/g);
assert.match(attention, /\.eq\("owner_id", input\.userId\)/g);
assert.match(attention, /\.eq\("user_id", input\.userId\)/g);
assert.match(attention, /task\.payload\?\.receivedAt/);
assert.match(attention, /source_event_key/);
assert.match(attention, /outreach_reply_delivery_failed/);
assert.doesNotMatch(
  attention,
  /from\("outreach_prospects"\)\s*\.update/,
  "Receipt recovery must never rewrite the canonical inbound reply"
);

// Counts and status labels are model-free. Failed drafts are recoverable and
// an interested reply becomes visibly overdue after two hours.
assert.match(metrics, /unansweredReplies/);
assert.match(metrics, /overdueReplies/);
assert.match(metrics, /replyCategory: "interested"/);
assert.match(metrics, /slaBreached/);
assert.match(metrics, /deliveryState/);
assert.match(metrics, /"failed"/);
assert.match(metrics, /replyReceivedAt/);
assert.match(metrics, /sameReply/);
assert.match(inbox, /Reply queued for/);
assert.match(inbox, /Awaiting provider delivery/);
assert.match(inbox, /Sending reply to/);
assert.match(inbox, /Waiting for the connected mailbox to confirm delivery/);
assert.match(inbox, /Retry reply to/);
assert.match(inbox, /matchesCurrentReply/);
assert.match(inbox, /meetingHandlesCurrentReply/);
assert.doesNotMatch(
  inbox,
  /isReply && message\.status === "approved" && message\.scheduled_at[\s\S]{0,120}handledReplyProspects\.add/
);
assert.match(today, /stays visible here until the connected mailbox confirms delivery/i);
assert.match(today, /unanswered/);
assert.match(today, /over 2 hours/);
assert.match(today, /Delivery failed/);
assert.match(outreachPage, /Unanswered replies/);
assert.match(outreachPage, /Queued, awaiting delivery/);
assert.match(outreachPage, /Unanswered over 2 hours/);

// Meeting conversion already reuses the canonical outreach context once. It
// updates the upcoming call's research and intent and records one booking event.
assert.match(bookingHandoff, /callPatch\.research = nextResearch/);
assert.match(bookingHandoff, /callPatch\.intent = intent/);
assert.match(bookingHandoff, /from\("upcoming_calls"\)\.update\(callPatch\)/);
assert.match(bookingHandoff, /kind: "meeting_booked"/);

console.log("Reply delivery safety and call handoff checks passed");
