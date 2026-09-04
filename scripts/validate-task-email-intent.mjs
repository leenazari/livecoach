import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260904130532_task_email_intent_send.sql"
);
const taskEmail = read("lib/task-email.ts");
const emailAssistant = read("lib/email-assistant.ts");
const workspaceRoute = read("app/api/crm/tasks/[id]/email/route.ts");
const sendRoute = read(
  "app/api/crm/email-assistant/drafts/[id]/send/route.ts"
);
const composer = read("components/crm/TaskEmailComposer.tsx");
const dashboard = read("components/crm/TaskDashboard.tsx");
const mail = read("lib/mail.ts");
const gmail = read("lib/gmail.ts");
const microsoft = read("lib/microsoft.ts");

// The database has an explicit in-flight claim and durable send receipt. A
// safe-share grant permits only the exact assignee and never a confidential
// client or a bare workspace member.
assert.match(migration, /'sending', 'sent'/);
assert.match(migration, /status <> 'sent' or sent_at is not null/);
assert.match(migration, /company\.is_confidential = false/);
assert.match(migration, /share\.assigned_to_user_id = new\.owner_id/);
assert.match(migration, /share\.status = 'active'/);
assert.match(
  migration,
  /revoke execute on function public\.validate_next_move_record_scope\(\)[\s\S]*?from public, anon, authenticated/
);

// Every browser operation derives workspace and owner from the verified
// session. The browser cannot name another owner or an arbitrary recipient.
assert.match(workspaceRoute, /requireRequestScope\(\)/);
assert.match(sendRoute, /requireRequestScope\(\)/);
assert.doesNotMatch(workspaceRoute, /body\?.(?:ownerId|userId|workspaceId)/);
assert.doesNotMatch(sendRoute, /body\?.(?:ownerId|userId|workspaceId)/);
assert.match(taskEmail, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(taskEmail, /\.eq\("owner_id", scope\.userId\)/);
assert.match(
  taskEmail,
  /recipients\.find\(\(candidate\) => candidate\.email === requestedEmail\)/
);
assert.match(taskEmail, /This task is not assigned to your account/);
assert.match(taskEmail, /This task is not an email action/);

// The draft uses the signed-in salesperson's tone and is never permission to
// send. Source-email replies stay bound to the latest provider conversation.
assert.match(taskEmail, /getSalesProfile\(scope\)/);
assert.match(taskEmail, /salesProfile\.emailTone/);
assert.match(taskEmail, /salesProfile\.personalContext/);
assert.match(taskEmail, /This remains a draft until the salesperson separately presses Approve and send/);
assert.match(taskEmail, /freshMessageText\(sourceMessageId/);
assert.match(taskEmail, /This reply belongs to your/);
assert.match(taskEmail, /source email conversation is incomplete/);
assert.match(taskEmail, /A newer email arrived in this conversation/);
assert.match(taskEmail, /message\.threadId === draft\.source_thread_id/);
assert.match(taskEmail, /reply subject must stay attached to the original conversation/i);

// Direct task mail does not become a route around suppression, campaign
// ownership, recent-contact safety, or exact per-user mailbox permissions.
assert.match(taskEmail, /from\("outreach_suppressions"\)/);
assert.match(taskEmail, /isActiveOutreachEnrolmentStatus/);
assert.match(taskEmail, /isInsideCrossCampaignCooldown/);
assert.match(taskEmail, /capabilities\.rehearsalReady/);
assert.match(taskEmail, /connection\.provider !== draft\.mail_provider/);
assert.match(taskEmail, /status: "sending"/);
assert.match(taskEmail, /\.eq\("status", "draft"\)[\s\S]*?sendConnectedMail/);
assert.match(taskEmail, /status: "sent"/);
assert.match(taskEmail, /finishTaskFromSentDraft/);
assert.match(taskEmail, /current\?\.status === "done"/);
assert.match(taskEmail, /email was sent, but the CRM could not confirm that its task was completed/i);
assert.match(taskEmail, /action: "task_email_sent"/);
assert.match(emailAssistant, /\| "sending"[\s\S]*?\| "sent"/);

// Gmail and Microsoft preserve a real reply when the task came from an inbound
// email. A new task email still uses the normal provider send path.
assert.match(mail, /sourceMessageId\?: string/);
assert.match(gmail, /opts\.sourceMessageId[\s\S]*?metadataHeaders=Message-ID/);
assert.match(microsoft, /opts\.sourceMessageId[\s\S]*?\/reply/);

// Tasks now expose the whole one-at-a-time workflow inline. Speech input,
// editable content, explicit send approval, and task completion are all visible.
assert.match(dashboard, /<TaskEmailComposer/);
assert.match(dashboard, /Write email/);
assert.doesNotMatch(dashboard, /lc:draft-email/);
assert.match(composer, /webkitSpeechRecognition/);
assert.match(composer, /foldDictationEvent/);
assert.match(composer, /What do you want to say or achieve/);
assert.match(composer, /Optimise email/);
assert.match(composer, /Save draft/);
assert.match(composer, /Approve and send/);
assert.match(composer, /const draftLocked/);
assert.match(composer, /const sourceReply/);
assert.match(composer, /keeps this reply in the original conversation/);
assert.match(composer, /result\.draft\?\.status !== "sent"/);
assert.match(composer, /One task · one exact recipient · one explicit send approval/);

console.log("Task email intent, approval, delivery, and two-user safety checks passed");
