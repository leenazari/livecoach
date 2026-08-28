import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const brain = read("app/api/crm/assistant/route.ts");
const sendRoute = read("app/api/crm/assistant/email/route.ts");
const assistant = read("components/crm/ClientAssistant.tsx");
const queue = read("lib/outreach-send-queue.ts");
const prospects = read("app/crm/outreach/page.tsx");
const revenueRoute = read("app/api/crm/revenue/route.ts");
const revenuePage = read("app/crm/revenue/page.tsx");
const migration = read(
  "supabase/migrations/20260828153401_brain_direct_outreach_messages.sql"
);

// The Brain proposes the exact external email, but it can never be included in
// the safe internal batch. Recipient, subject and body remain visible for a
// separate human approval.
assert.match(brain, /if \(it\.type === "send_email"\)/);
assert.match(brain, /external: true/);
assert.match(brain, /"send_email",/);
assert.match(brain, /A campaign is optional/);
assert.match(assistant, /a\.emailPreview\.subject/);
assert.match(assistant, /a\.emailPreview\.body/);
assert.match(assistant, /approve & queue email/);

// One-off mail uses the canonical sender-scoped outreach ledger. It is
// idempotent and retains the existing suppression, ownership, CRM relationship,
// active campaign and 30 day cooldown protections.
assert.match(sendRoute, /resolveOutreachIdentity\(\)/);
assert.match(sendRoute, /\.eq\("request_key", requestKey\)/);
assert.match(sendRoute, /\.eq\("workspace_id", sender\.workspaceId\)/);
assert.match(sendRoute, /\.eq\("sender_user_id", sender\.userId\)/);
assert.match(sendRoute, /outreach_suppressions/);
assert.match(sendRoute, /isActiveOutreachEnrolmentStatus/);
assert.match(sendRoute, /isInsideCrossCampaignCooldown/);
assert.match(sendRoute, /message_source: "brain_direct"/);
assert.match(sendRoute, /campaign_id: null/);
assert.match(sendRoute, /enrolment_id: null/);
assert.match(sendRoute, /queueApprovedOutreachMessage/);
assert.match(queue, /const isBrainDirect = message\.message_source === "brain_direct"/);
assert.match(queue, /isBrainDirect \? OUTREACH_DAILY_HARD_LIMIT/);
assert.match(queue, /isActiveOutreachEnrolmentStatus/);
assert.match(queue, /isInsideCrossCampaignCooldown/);

// The database distinguishes campaign and Brain mail without inventing a
// campaign. A sender-scoped request key makes retries safe.
assert.match(migration, /message_source in \('campaign', 'brain_direct'\)/);
assert.match(migration, /message_source = 'brain_direct'[\s\S]*campaign_id is null[\s\S]*enrolment_id is null/);
assert.match(migration, /outreach_messages_sender_request_key_unique/);

// Recent Brain activity is immediately discoverable from both product areas,
// while the pipeline does not manufacture a revenue opportunity.
assert.match(prospects, /setProspectSort\("activity"\)/);
assert.match(prospects, /if \(requestedSearch\) setQ\(requestedSearch\)/);
assert.match(prospects, /Brain email/);
assert.match(revenueRoute, /\.eq\("sender_user_id", account\.userId\)/);
assert.match(revenueRoute, /recentOutreach/);
assert.match(revenueRoute, /companyByProspect/);
assert.match(revenueRoute, /lastTouchByCompany\.set\(companyId, at\)/);
assert.match(revenuePage, /id="recent-outreach"/);
assert.match(revenuePage, /without inflating the revenue forecast/);

console.log("Brain direct email and recent activity checks passed");
