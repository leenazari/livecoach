import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260902230045_add_important_email_notification_kind.sql"
);
const notificationWriter = read("lib/crm-notification-writes.ts");
const notificationHelpers = read("lib/crm-notifications.ts");
const notificationAlerts = read("components/crm/NotificationAlerts.tsx");
const notificationPage = read("app/crm/notifications/page.tsx");
const emailMonitor = read("app/api/cron/important-email-monitor/route.ts");
const taskWriter = read("lib/tasks.ts");
const replyAttention = read("lib/reply-attention.ts");
const sendPilot = read("lib/sendpilot-outreach.ts");

assert.match(migration, /kind in \([\s\S]*'important_email'/);
assert.doesNotMatch(
  migration,
  /insert into public\.crm_notifications/i,
  "The notification upgrade must not replay historical emails"
);

assert.match(notificationWriter, /import "server-only"/);
assert.match(notificationWriter, /\.eq\("workspace_id", input\.workspaceId\)/);
assert.match(notificationWriter, /\.eq\("user_id", input\.userId\)/);
assert.match(notificationWriter, /\.eq\("status", "active"\)/);
assert.match(notificationWriter, /kind: "important_email"/);
assert.match(notificationWriter, /onConflict: "user_id,source_event_key"/);
assert.match(notificationWriter, /ignoreDuplicates: true/);
assert.doesNotMatch(
  notificationWriter,
  /created_at:/,
  "New notification attention time must be the insert time, not an older email timestamp"
);
assert.doesNotMatch(notificationWriter, /supabaseAdmin/);

assert.match(notificationHelpers, /\| "important_email"/);
assert.match(
  notificationHelpers,
  /kind === "outreach_reply" \|\| kind === "important_email"/
);
assert.match(notificationAlerts, /Important pipeline email/);
assert.match(
  notificationPage,
  /item\.kind === "outreach_reply" \|\| item\.kind === "important_email"/
);
assert.match(notificationPage, /Important email/);

assert.match(emailMonitor, /createImportantEmailNotification/);
assert.match(emailMonitor, /ensureReplyAttentionTask/);
assert.match(emailMonitor, /channel: "email"/);
assert.match(emailMonitor, /sourceEventKey: `important_email:\$\{identity\.provider\}:\$\{message\.id\}`/);
assert.match(emailMonitor, /workspaceId: identity\.workspaceId/);
assert.match(emailMonitor, /userId: identity\.userId/);
assert.match(emailMonitor, /distinctSourceEvent: true/g);
assert.match(emailMonitor, /Task added\./);

assert.match(taskWriter, /distinctSourceEvent\?: boolean/);
assert.match(taskWriter, /if \(i\.distinctSourceEvent\)/);
assert.match(replyAttention, /runWithServiceRecordScope/);
assert.match(replyAttention, /\.eq\("status", "active"\)/);
assert.match(replyAttention, /userId: input\.userId, workspaceId: input\.workspaceId/);
assert.match(replyAttention, /\? "sendpilot_reply"[\s\S]*: "outreach_reply"/);
assert.match(replyAttention, /outreachProspectId: input\.prospectId/);
assert.match(replyAttention, /distinctSourceEvent: true/);
assert.doesNotMatch(
  replyAttention,
  /replyText|last_reply_text|input\.reply/,
  "Reply tasks should retain concise outcomes, not duplicate raw messages"
);

assert.match(sendPilot, /ensureReplyAttentionTask/);
assert.match(sendPilot, /\.eq\("workspace_id", integration\.workspace_id\)/g);
assert.match(sendPilot, /\.eq\("assigned_to_user_id", integration\.owner_id\)/g);
assert.match(sendPilot, /workspaceId: integration\.workspace_id/g);
assert.match(sendPilot, /userId: integration\.owner_id/g);
assert.match(sendPilot, /sourceRef: `sendpilot_reply:\$\{providerMessageId\}`/);
assert.match(sendPilot, /sourceRef: `sendpilot_reply:\$\{message\.messageId\}`/);
assert.match(sendPilot, /integration\.last_backfill_at/);
assert.match(sendPilot, /receivedAt > lastBackfillAt/);

console.log(
  "Inbound email and SendPilot notification plus task checks passed"
);
