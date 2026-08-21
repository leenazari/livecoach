import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260821222044_team_outreach_contact_safety.sql"
);
const assignmentFix = read(
  "supabase/migrations/20260821224415_fix_outreach_assignment_trigger_polymorphism.sql"
);
const relationshipScope = read(
  "supabase/migrations/20260821224750_harden_outreach_relationship_scope.sql"
);
const frozenDeliveryIdentity = read(
  "supabase/migrations/20260821224937_freeze_inflight_outreach_identity.sql"
);
const emailOnlyDedup = read(
  "supabase/migrations/20260821225550_email_only_outreach_dedup.sql"
);
const helper = read("lib/outreach-team-safety.ts");
const queue = read("app/api/crm/outreach/queue/route.ts");
const dataRoute = read("app/api/crm/outreach/route.ts");
const sendQueue = read("lib/outreach-send-queue.ts");
const sendCron = read("app/api/cron/outreach-send/route.ts");
const messageRoute = read("app/api/crm/outreach/messages/[id]/route.ts");
const outreachPage = read("app/crm/outreach/page.tsx");

for (const column of [
  "recipient_email",
  "company_key",
  "delivery_day",
  "claim_expires_at",
  "cooldown_override_at",
  "cooldown_override_by",
  "cooldown_override_reason",
]) {
  assert.match(migration, new RegExp(`\\b${column}\\b`));
}

for (const originalGuard of [
  "outreach_one_active_campaign_per_contact",
  "outreach_one_company_per_queue_day",
  "outreach_one_approved_message_per_contact",
  "outreach_one_recipient_per_delivery_day",
  "outreach_one_company_per_delivery_day",
  "outreach_one_sender_per_send_slot",
]) {
  assert.match(
    migration,
    new RegExp(`create unique index if not exists ${originalGuard}`)
  );
}

assert.match(migration, /interval '30 days'/);
assert.match(migration, /wm\.role in \('owner', 'manager'\)/);
assert.match(migration, /kind[\s\S]*'safety_override'/);
assert.match(migration, /status in \('draft', 'approved', 'sending', 'sent', 'failed', 'cancelled'\)/);
assert.match(migration, /old\.status = 'sending'[\s\S]*new\.status not in \('sent', 'failed'\)/);
assert.match(migration, /status in \('draft', 'approved'\)[\s\S]*recipient_email is distinct from next_email/);
assert.match(migration, /status in \([\s\S]*'contacted',[\s\S]*'paused'[\s\S]*recipient_email is distinct from next_email/);
assert.match(migration, /revoke execute on function public\.protect_outreach_message_in_flight\(\)/);
assert.doesNotMatch(
  migration,
  /create or replace function public\.(?:apply|sync|audit|protect)_outreach[\s\S]*?security definer/i,
  "Outreach safety triggers must not bypass row security"
);
assert.match(relationshipScope, /c\.workspace_id = workspace_value/);
assert.match(relationshipScope, /p\.workspace_id = workspace_value/);
assert.match(relationshipScope, /e\.campaign_id = campaign_value/);
assert.match(relationshipScope, /e\.prospect_id = prospect_value/);
assert.match(relationshipScope, /outreach_messages_validate_relationship_scope/);
assert.match(frozenDeliveryIdentity, /old\.status = 'sending'/);
assert.match(frozenDeliveryIdentity, /new\.recipient_email := old\.recipient_email/);
assert.match(frozenDeliveryIdentity, /new\.company_key := old\.company_key/);
assert.match(frozenDeliveryIdentity, /outreach_messages_freeze_inflight_identity/);
assert.match(assignmentFix, /to_jsonb\(new\)->>'sender_user_id'/);
assert.match(assignmentFix, /to_jsonb\(new\)->>'assigned_to_user_id'/);
assert.doesNotMatch(
  assignmentFix,
  /when tg_table_name = 'outreach_messages' then new\.sender_user_id/
);

assert.match(helper, /OUTREACH_CROSS_CAMPAIGN_COOLDOWN_DAYS = 30/);
assert.match(helper, /outreach_one_active_campaign_per_recipient_email/);
assert.match(helper, /outreach_one_approved_message_per_recipient_email/);
assert.doesNotMatch(helper, /outreach_one_company_per_(queue|delivery)_day/);

assert.match(emailOnlyDedup, /drop index if exists public\.outreach_one_company_per_queue_day/);
assert.match(emailOnlyDedup, /drop index if exists public\.outreach_one_company_per_delivery_day/);
assert.match(emailOnlyDedup, /create unique index outreach_one_active_campaign_per_recipient_email[\s\S]*workspace_id, recipient_email/);
assert.match(emailOnlyDedup, /create unique index outreach_one_approved_message_per_recipient_email[\s\S]*workspace_id, recipient_email/);
assert.match(emailOnlyDedup, /e\.recipient_email = new\.recipient_email/);
assert.match(emailOnlyDedup, /interval '30 days'/);
assert.doesNotMatch(
  emailOnlyDedup,
  /create unique index outreach_one_company_per_(queue|delivery)_day/
);

assert.match(queue, /isActiveOutreachEnrolmentStatus/);
assert.match(queue, /isInsideCrossCampaignCooldown/);
assert.match(queue, /\["owner", "manager"\]\.includes\(requestScope\.role\)/);
assert.match(queue, /cooldownOverrideReason/);
assert.match(queue, /Another teammate claimed this prospect first/);
assert.match(queue, /\.eq\("recipient_email", email\)/);
assert.match(queue, /reservedEmailsForAnotherCampaign/);
assert.match(queue, /chosenEmails\.has\(email\)/);
assert.doesNotMatch(queue, /CompanyReservations|companyReservations|chosenCompanies/);
assert.match(dataRoute, /activeCampaignIdsByProspect/);
assert.match(dataRoute, /activeCampaignIdsByEmail/);

assert.match(sendQueue, /isDeliveryDayConflict/);
assert.match(sendQueue, /isSenderSlotConflict/);
assert.match(sendQueue, /claim_expires_at/);
assert.match(sendQueue, /Recipient safety identity changed before send/);
assert.match(sendQueue, /status: "sending"/);
assert.match(sendQueue, /\.eq\("recipient_email", email\)/);
assert.doesNotMatch(sendQueue, /\.eq\("company_key", companyKey\)/);
assert.ok(
  sendQueue.indexOf('status: "sending"') <
    sendQueue.indexOf("sendConnectedOutreachMail({"),
  "The irreversible delivery state must be recorded before calling Gmail"
);
assert.match(sendCron, /claim_expires_at\.is\.null/);
assert.match(messageRoute, /\["sending", "sent"\]\.includes\(existing\.status\)/);

assert.match(outreachPage, /Exact email addresses are checked across the whole team/);
assert.match(outreachPage, /Different people at the same company remain available for outreach/);
assert.match(outreachPage, /Manager overrides require a saved reason/);
assert.match(outreachPage, /Sending now/);

console.log("Team outreach safety checks passed");
