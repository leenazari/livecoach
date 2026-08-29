import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SENDPILOT_BACKFILL_DAYS,
  parseSendPilotReplyEvent,
  parseSendPilotWebhookEvent,
  sendPilotMessageFingerprint,
  verifySendPilotWebhookSignature,
} from "../lib/sendpilot-contract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

assert.equal(SENDPILOT_BACKFILL_DAYS, 14);

const payload = JSON.stringify({
  eventId: "evt_test_123",
  eventType: "reply.received",
  timestamp: "2026-08-28T21:30:00.000Z",
  workspaceId: "ws_test",
  data: {
    leadId: "lead_test",
    campaignId: "campaign_test",
    linkedinUrl: "https://www.linkedin.com/in/example-person",
    senderId: "sender_test",
    reply: "Could we arrange a demo?",
  },
});
const signatureTimestamp = "1787952600";
const secret = "test-webhook-secret-with-more-than-32-characters";
const signature = createHmac("sha256", secret)
  .update(`${signatureTimestamp}.${payload}`)
  .digest("hex");
assert.equal(
  verifySendPilotWebhookSignature(
    payload,
    `t=${signatureTimestamp},s=${signature}`,
    secret,
    1_787_952_600_000
  ),
  true
);
assert.equal(
  verifySendPilotWebhookSignature(
    payload,
    `t=${signatureTimestamp},s=${signature}`,
    secret,
    1_787_953_000_001
  ),
  false,
  "Webhook signatures older than five minutes must fail closed"
);
assert.equal(
  verifySendPilotWebhookSignature(
    `${payload} `,
    `t=${signatureTimestamp},s=${signature}`,
    secret,
    1_787_952_600_000
  ),
  false,
  "The signature must cover the exact raw request body"
);

const event = parseSendPilotReplyEvent(JSON.parse(payload));
assert.equal(event.eventType, "reply.received");
assert.equal(event.data.senderId, "sender_test");
assert.equal(
  parseSendPilotWebhookEvent({
    eventId: "evt_message_123",
    eventType: "message.sent",
    timestamp: "2026-08-28T21:31:00.000Z",
    workspaceId: "ws_test",
    data: {
      leadId: "lead_test",
      campaignId: "campaign_test",
      linkedinUrl: "https://www.linkedin.com/in/example-person",
      senderId: "sender_test",
      message: "Hello",
      sequenceStep: 2,
    },
  }).eventType,
  "message.sent"
);
assert.equal(
  parseSendPilotWebhookEvent({
    eventId: "evt_status_123",
    eventType: "lead.updated",
    timestamp: "2026-08-28T21:32:00.000Z",
    workspaceId: "ws_test",
    data: {
      leadId: "lead_test",
      campaignId: "campaign_test",
      linkedinUrl: "https://www.linkedin.com/in/example-person",
      previousStatus: "PENDING",
      newStatus: "REPLIED",
    },
  }).eventType,
  "lead.updated"
);

const fingerprint = sendPilotMessageFingerprint({
  senderProfileUrl: event.data.linkedinUrl,
  receivedAt: event.timestamp,
  body: event.data.reply,
});
assert.equal(
  fingerprint,
  sendPilotMessageFingerprint({
    senderProfileUrl: event.data.linkedinUrl,
    receivedAt: event.timestamp,
    body: event.data.reply,
  }),
  "Webhook and API backfill representations must deduplicate to one message"
);

const [
  apiClient,
  integration,
  credentials,
  webhookRoute,
  managementRoute,
  backfillRoute,
  migration,
  indexMigration,
  importer,
  settings,
] = await Promise.all([
  read("lib/sendpilot-api.ts"),
  read("lib/sendpilot.ts"),
  read("lib/sendpilot-credentials.ts"),
  read("app/api/webhooks/sendpilot/[token]/route.ts"),
  read("app/api/crm/sendpilot/route.ts"),
  read("app/api/crm/sendpilot/backfill/route.ts"),
  read("supabase/migrations/20260828223135_sendpilot_inbound_integration.sql"),
  read("supabase/migrations/20260828223238_index_sendpilot_webhook_owner.sql"),
  read("lib/linkedin-inbox.ts"),
  read("app/settings/page.tsx"),
]);

assert(apiClient.includes('method: "POST"'));
assert(!apiClient.includes('method: "PATCH"'));
assert(!apiClient.includes('method: "PUT"'));
assert(!apiClient.includes('method: "DELETE"'));
assert(!apiClient.includes("/v1/inbox/messages"));
assert(apiClient.includes('"/v1/inbox/senders"'));
assert(apiClient.includes("/v1/inbox/conversations"));
assert(apiClient.includes("/v1/leads/"));
assert(apiClient.includes('sendPilotRequest("/v1/leads"'));
assert(integration.includes("SENDPILOT_BACKFILL_DAYS"));
assert(integration.includes('source: "sendpilot_webhook"'));
assert(integration.includes('source: "sendpilot_api"'));
assert.equal(
  integration.match(/createContactWhenUnmatched: false/g)?.length,
  2,
  "Webhook and backfill imports must route unmatched SendPilot people to review"
);
assert(!integration.includes("createContactWhenUnmatched: !!senderName"));
assert(integration.includes('.eq("payload_digest", payloadDigest)'));
assert(integration.includes('.eq("status", "failed")'));
assert(credentials.includes('createCipheriv("aes-256-gcm"'));
assert(credentials.includes("cipher.setAAD"));
assert(webhookRoute.includes("webhook-signature"));
assert(webhookRoute.includes("waitUntil(processSendPilotWebhookEvent"));
assert(webhookRoute.includes("SENDPILOT_MAX_WEBHOOK_BYTES"));
assert(managementRoute.includes("requireRequestScope"));
assert(backfillRoute.includes("runSendPilotBackfill"));
assert(migration.includes("alter table public.sendpilot_integrations enable row level security"));
assert(migration.includes("revoke all on public.sendpilot_integrations from public, anon, authenticated"));
assert(migration.includes("unique (integration_id, provider_event_id)"));
assert(indexMigration.includes("sendpilot_webhook_events_owner_idx"));
assert(importer.includes("crossSourceDuplicates"));
assert(importer.includes("sender_name_not_verified"));
assert(settings.includes("SendPilot LinkedIn CRM"));
assert.match(settings, /cannot start campaigns, change their sequence/);

console.log("SendPilot inbound integration validation passed");
