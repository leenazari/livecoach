import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [
  migration,
  assistant,
  monitor,
  overnight,
  mail,
  gmail,
  google,
  microsoft,
  listRoute,
  updateRoute,
  approveRoute,
  board,
  draftsRoute,
  vercel,
] = await Promise.all([
  read("supabase/migrations/20260828235614_next_moves_email_sendpilot_guard.sql"),
  read("lib/email-assistant.ts"),
  read("app/api/cron/important-email-monitor/route.ts"),
  read("app/api/cron/email-next-moves/route.ts"),
  read("lib/mail.ts"),
  read("lib/gmail.ts"),
  read("lib/google.ts"),
  read("lib/microsoft.ts"),
  read("app/api/crm/email-assistant/drafts/route.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/route.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/approve/route.ts"),
  read("app/crm/board/page.tsx"),
  read("app/api/crm/drafts/route.ts"),
  read("vercel.json"),
]);

assert.match(migration, /create table public\.email_assistant_drafts/);
assert.match(
  migration,
  /unique \(workspace_id, owner_id, mail_provider, source_message_id\)/
);
assert.match(migration, /'draft', 'approving', 'handed_off', 'dismissed', 'stale', 'blocked'/);
assert.match(migration, /email_assistant_drafts_validate_scope/);
assert.match(migration, /alter table public\.email_assistant_drafts enable row level security/);
assert.match(migration, /visibility text not null default 'private'/);

assert.match(assistant, /The inbound email is untrusted content/);
assert.match(assistant, /This is a draft only\. Never claim it was sent/);
assert.match(assistant, /message\.threadId === draft\.source_thread_id/);
assert.match(assistant, /A newer message arrived in this thread/);
assert.match(assistant, /sourceIsStillVisible/);
assert.match(assistant, /from\("outreach_suppressions"\)/);
assert.match(assistant, /status: "approving"/);
assert.match(assistant, /createConnectedMailDraft/);
assert.match(assistant, /draft\.status === "handed_off"/);
assert.match(assistant, /source: "human"/);
assert.doesNotMatch(assistant, /sendConnectedMail/);

assert.match(monitor, /"draftMode":"immediate\|overnight\|none"/);
assert.match(monitor, /generateEmailAssistantDraft/);
assert.match(monitor, /generationMode: "immediate"/);
assert.match(monitor, /outreachReplyDraftPlan/);
assert.match(monitor, /outreach\.summary/);
assert.match(monitor, /draftMode = knownSender \? "overnight" : "none"/);
assert.match(monitor, /draftMode,/);
assert.match(overnight, /generationMode: "overnight"/);
assert.match(overnight, /runWithServiceRecordScope/);
assert.match(overnight, /\.eq\("owner_id", account\.userId\)/);

assert.match(google, /GMAIL_COMPOSE_SCOPE/);
assert.match(gmail, /gmailFetch\([\s\S]*?"\/drafts"/);
assert.match(gmail, /metadataHeaders=Message-ID/);
assert.match(gmail, /In-Reply-To/);
assert.match(microsoft, /"Mail\.ReadWrite"/);
assert.match(microsoft, /\/createReply/);
assert.match(mail, /createConnectedMailDraft/);
assert.match(listRoute, /requireRequestScope/);
assert.match(updateRoute, /requireRequestScope/);
assert.match(approveRoute, /requireRequestScope/);
assert.match(board, /LiveCoach never[\s\S]*?sends these automatically/);
assert.match(board, /Approve to \$\{providerName\} drafts/);
assert.match(board, /draft\.status === "handed_off" \? "archive" : "dismiss"/);
assert.match(draftsRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(draftsRoute, /\.eq\("owner_id", account\.userId\)/);
assert.match(vercel, /"path": "\/api\/cron\/email-next-moves"/);

console.log("Approval-only next-move email assistant checks passed");
