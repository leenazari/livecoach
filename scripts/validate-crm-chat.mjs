import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read("supabase/migrations/20260829181352_workspace_chat.sql");
const advisorMigration = read(
  "supabase/migrations/20260829181535_workspace_chat_advisor_hardening.sql"
);
const attachmentLimitMigration = read(
  "supabase/migrations/20260830085235_chat_20mb_attachments.sql"
);
const chatRoute = read("app/api/crm/chat/route.ts");
const messagesRoute = read(
  "app/api/crm/chat/[conversationId]/messages/route.ts"
);
const uploadsRoute = read(
  "app/api/crm/chat/[conversationId]/uploads/route.ts"
);
const fileRoute = read("app/api/crm/chat/files/[attachmentId]/route.ts");
const driveRoute = read(
  "app/api/crm/chat/files/[attachmentId]/drive/route.ts"
);
const helpers = read("lib/crm-chat.ts");
const shared = read("lib/crm-chat-shared.ts");
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
assert.match(attachmentLimitMigration, /crm_chat_attachments_file_size_check/);
assert.match(attachmentLimitMigration, /file_size between 1 and 20971520/);
assert.match(attachmentLimitMigration, /file_size_limit = 20971520/);
assert.match(attachmentLimitMigration, /crm_chat_attachments_storage_path_unique_idx/);
assert.match(shared, /CHAT_MAX_FILE_BYTES = 20 \* 1024 \* 1024/);
assert.match(shared, /CHAT_INLINE_PREVIEW_MIME_TYPES/);
assert.doesNotMatch(
  shared.match(/CHAT_INLINE_PREVIEW_MIME_TYPES[\s\S]*?\]\);/)?.[0] || "",
  /wordprocessingml|spreadsheetml|presentationml|application\/msword/,
  "Office files must remain download only"
);
assert.match(messagesRoute, /Files are limited to 20 MB/);
assert.match(page, /Files up to 20 MB/);
assert.match(advisorMigration, /No browser access to chat email deliveries/);
assert.match(advisorMigration, /using \(false\)/);
assert.match(advisorMigration, /crm_chat_messages_sender_idx/);
assert.match(advisorMigration, /crm_chat_attachments_conversation_idx/);

for (const route of [chatRoute, messagesRoute, uploadsRoute, fileRoute, driveRoute]) {
  assert.match(route, /requireRequestScope\(\)/);
  assert.match(route, /scope\.workspaceId/);
}
assert.match(chatRoute, /\.from\("crm_chat_conversations"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(messagesRoute, /\.from\("crm_chat_messages"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(fileRoute, /\.from\("crm_chat_attachments"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(messagesRoute, /requireChatMembership/);
assert.match(messagesRoute, /CHAT_ALLOWED_MIME_TYPES/);
assert.match(messagesRoute, /CHAT_MAX_FILE_BYTES/);
assert.match(messagesRoute, /isOwnedChatUploadPath/);
assert.match(messagesRoute, /removeUnattachedChatUpload/);
assert.match(messagesRoute, /\.info\(uploadedPath\)/);
assert.doesNotMatch(messagesRoute, /req\.formData\(\)/);
assert.doesNotMatch(messagesRoute, /Buffer\.from\(await file\.arrayBuffer\(\)\)/);
assert.match(messagesRoute, /post_crm_chat_message_service/);
assert.match(messagesRoute, /sendChatEmailNotifications/);
assert.match(uploadsRoute, /requireChatMembership/);
assert.match(uploadsRoute, /createSignedUploadUrl/);
assert.match(uploadsRoute, /scope\.workspaceId/);
assert.match(uploadsRoute, /scope\.userId/);
assert.match(fileRoute, /requireChatMembership/);
assert.match(fileRoute, /createSignedUrl/);
assert.match(fileRoute, /CHAT_INLINE_PREVIEW_MIME_TYPES/);
assert.match(fileRoute, /mime_type/);
assert.match(fileRoute, /searchParams\.get\("mode"\) === "open"/);
assert.match(fileRoute, /This file is download only/);
assert.match(fileRoute, /createSignedUrl\(attachment\.storage_path, 60\)/);
assert.match(fileRoute, /createSignedUrl\(attachment\.storage_path, 60, \{ download: fileName \}\)/);
assert.match(fileRoute, /NextResponse\.redirect/);
assert.doesNotMatch(fileRoute, /arrayBuffer\(\)/);
assert.match(fileRoute, /X-Content-Type-Options/);
assert.match(fileRoute, /Cache-Control.*private, no-store/);
assert.match(driveRoute, /requireChatMembership/);
assert.match(driveRoute, /getAccessToken\(false, scope\.userId\)/);
assert.match(driveRoute, /findChatAttachmentInDrive/);
assert.match(driveRoute, /CHAT_MAX_FILE_BYTES/);
assert.match(driveRoute, /\.download\(attachment\.storage_path\)/);
assert.match(driveRoute, /chat_attachment_saved_to_google_drive/);
assert.match(driveRoute, /Cache-Control.*private, no-store/);

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
assert.match(page, /uploadToSignedUrl/);
assert.match(page, /Files are limited to 20 MB/);
assert.match(page, /CHAT_INLINE_PREVIEW_MIME_TYPES/);
assert.match(page, /mode=\$\{mode\}/);
assert.match(page, /role="dialog"/);
assert.match(page, />\s*Open\s*</);
assert.match(page, />\s*Download\s*</);
assert.match(page, /mimeType\.startsWith\("image\/"\)/);
assert.match(page, /mimeType\.startsWith\("audio\/"\)/);
assert.match(page, /mimeType\.startsWith\("video\/"\)/);
assert.match(page, /<iframe/);
assert.match(page, /Save to Drive/);
assert.match(page, /Open Drive/);
assert.match(page, /\/api\/crm\/chat\/files\/\$\{attachment\.id\}\/drive/);
assert.doesNotMatch(
  page,
  /MatrixRain/,
  "Team Chat must not render a permanent page-level loading banner"
);
assert.match(page, /\{loading \? \(/);
assert.match(page, /Loading chat…/);
assert.match(clientPage, /shareType=company/);
assert.match(clientPage, /shareType=contact/);
assert.match(clientPage, /Calls, notes, transcripts, mailbox context and Brain memory stay private/);
assert.match(nav, /href: "\/crm\/chat"/);
assert.match(nav, /chatUnreadCount/);
assert.match(notifications, /"chat_message"/);
assert.match(notifications, /chatEmailEnabled/);
assert.match(alerts, /New team message/);

console.log("CRM workspace chat checks passed");
