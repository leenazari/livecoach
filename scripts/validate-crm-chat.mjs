import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read("supabase/migrations/20260829120000_workspace_chat.sql");
const advisorMigration = read(
  "supabase/migrations/20260829121500_workspace_chat_advisor_hardening.sql"
);
const chatRoute = read("app/api/crm/chat/route.ts");
const messagesRoute = read(
  "app/api/crm/chat/[conversationId]/messages/route.ts"
);
const fileRoute = read("app/api/crm/chat/files/[attachmentId]/route.ts");
const helpers = read("lib/crm-chat.ts");
const page = read("app/crm/chat/page.tsx");
const clientPage = read("app/crm/[id]/page.tsx");
const nav = read("components/crm/NavMenu.tsx");
const notifications = read("lib/crm-notifications.ts");
const alerts = read("components/crm/NotificationAlerts.tsx");

for (const table of [
  "crm_chat_conversations",
  "crm_chat_conversation_members",
  "crm_chat_messages",
  "crm_chat_attachments",
  "crm_chat_email_deliveries",
]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(
    migration,
    new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`)
  );
}

assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /wm\.status = 'active'/g);
assert.match(migration, /Conversation members read conversations/);
assert.match(migration, /Conversation members read messages/);
assert.match(migration, /Conversation members read attachments/);
assert.doesNotMatch(
  migration,
  /grant (?:insert|update|delete)[^\n]*authenticated/,
  "Chat writes must pass through membership-checking server boundaries"
);
assert.match(migration, /create_crm_chat_conversation_service/);
assert.match(migration, /Every chat participant must be an active member/);
assert.match(migration, /post_crm_chat_message_service/);
assert.match(migration, /Conversation membership is required/);
assert.match(migration, /client_nonce/);
assert.match(migration, /interval '1 minute'/);
assert.match(migration, /unread_count = unread_count \+ 1/);
assert.match(migration, /crm_record_shared_in_chat/);
assert.match(migration, /kind in \('outreach_reply', 'lead_assigned', 'chat_message'\)/);
assert.match(migration, /source_table in \([\s\S]*'crm_chat_messages'/);
assert.match(migration, /The receipt never[\s\S]*message body/);
assert.match(migration, /'crm-chat-files'/);
assert.match(migration, /10485760/);
assert.match(migration, /public, file_size_limit/);
assert.match(advisorMigration, /No browser access to chat email deliveries/);
assert.match(advisorMigration, /using \(false\)/);
assert.match(advisorMigration, /crm_chat_messages_sender_idx/);
assert.match(advisorMigration, /crm_chat_attachments_conversation_idx/);

for (const route of [chatRoute, messagesRoute, fileRoute]) {
  assert.match(route, /requireRequestScope\(\)/);
  assert.match(route, /scope\.workspaceId/);
}
assert.match(chatRoute, /\.from\("crm_chat_conversations"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(messagesRoute, /\.from\("crm_chat_messages"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(fileRoute, /\.from\("crm_chat_attachments"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(messagesRoute, /requireChatMembership/);
assert.match(messagesRoute, /CHAT_ALLOWED_MIME_TYPES/);
assert.match(messagesRoute, /CHAT_MAX_FILE_BYTES/);
assert.match(messagesRoute, /post_crm_chat_message_service/);
assert.match(messagesRoute, /sendChatEmailNotifications/);
assert.match(fileRoute, /requireChatMembership/);
assert.match(fileRoute, /X-Content-Type-Options/);
assert.match(fileRoute, /Cache-Control.*private, no-store/);

assert.match(helpers, /is_confidential/);
assert.match(helpers, /Confidential clients cannot be shared into chat/);
assert.match(helpers, /Contacts at confidential clients cannot be shared into chat/);
assert.match(helpers, /The message and any shared CRM details stay inside LiveCoach/);
assert.doesNotMatch(
  helpers,
  /text: `\$\{[^}]*body|html: `[^`]*\$\{[^}]*body/,
  "Email alerts must not copy chat message bodies"
);
assert.match(helpers, /crm_chat_email_deliveries/);
assert.match(helpers, /deliveryError\?\.code === "23505"/);

assert.match(page, /New message or group/);
assert.match(page, /Direct message/);
assert.match(page, /Create private group/);
assert.match(page, /Attach file/);
assert.match(page, /Only the safe card fields are copied/);
assert.match(page, /lc:notifications-realtime/);
assert.match(page, /clientNonce/);
assert.match(page, /Shift Enter for a new line/);
assert.match(clientPage, /shareType=company/);
assert.match(clientPage, /shareType=contact/);
assert.match(clientPage, /Calls, notes, transcripts, mailbox context and Brain memory stay private/);
assert.match(nav, /href: "\/crm\/chat"/);
assert.match(nav, /chatUnreadCount/);
assert.match(notifications, /"chat_message"/);
assert.match(notifications, /chatEmailEnabled/);
assert.match(alerts, /New team message/);

console.log("CRM workspace chat checks passed");
