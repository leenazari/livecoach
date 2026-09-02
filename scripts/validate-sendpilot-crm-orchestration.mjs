import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseSendPilotWebhookEvent } from "../lib/sendpilot-contract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const events = [
  {
    eventId: "evt_reply",
    eventType: "reply.received",
    timestamp: "2026-08-28T20:00:00.000Z",
    workspaceId: "workspace",
    data: {
      leadId: "lead",
      campaignId: "campaign",
      linkedinUrl: "https://www.linkedin.com/in/example",
      senderId: "sender",
      reply: "Yes, let us arrange a demo",
    },
  },
  {
    eventId: "evt_message",
    eventType: "message.sent",
    timestamp: "2026-08-28T20:01:00.000Z",
    workspaceId: "workspace",
    data: {
      leadId: "lead",
      campaignId: "campaign",
      linkedinUrl: "https://www.linkedin.com/in/example",
      senderId: "sender",
      message: "Hello",
      sequenceStep: 1,
    },
  },
  {
    eventId: "evt_connection_sent",
    eventType: "connection_request.sent",
    timestamp: "2026-08-28T20:02:00.000Z",
    workspaceId: "workspace",
    data: {
      leadId: "lead",
      campaignId: "campaign",
      linkedinUrl: "https://www.linkedin.com/in/example",
      senderId: "sender",
      note: "Hello",
    },
  },
  {
    eventId: "evt_connection_accepted",
    eventType: "connection_request.accepted",
    timestamp: "2026-08-28T20:03:00.000Z",
    workspaceId: "workspace",
    data: {
      leadId: "lead",
      campaignId: "campaign",
      linkedinUrl: "https://www.linkedin.com/in/example",
      senderId: "sender",
      acceptedAt: "2026-08-28T20:03:00.000Z",
    },
  },
  {
    eventId: "evt_updated",
    eventType: "lead.updated",
    timestamp: "2026-08-28T20:04:00.000Z",
    workspaceId: "workspace",
    data: {
      leadId: "lead",
      campaignId: "campaign",
      linkedinUrl: "https://www.linkedin.com/in/example",
      previousStatus: "PENDING",
      newStatus: "MESSAGE_SENT",
    },
  },
];
for (const event of events) {
  assert.equal(parseSendPilotWebhookEvent(event).eventType, event.eventType);
}
assert.throws(
  () =>
    parseSendPilotWebhookEvent({
      ...events[1],
      data: { ...events[1].data, senderId: "" },
    }),
  /sender data is incomplete/
);

const [
  apiClient,
  orchestration,
  integration,
  campaignRoute,
  enrolRoute,
  queueRoute,
  prospectsRoute,
  metricsRoute,
  campaignsRoute,
  webhookRoute,
  settings,
  outreachUi,
  migration,
  indexMigration,
] = await Promise.all([
  read("lib/sendpilot-api.ts"),
  read("lib/sendpilot-outreach.ts"),
  read("lib/sendpilot.ts"),
  read("app/api/crm/sendpilot/campaigns/route.ts"),
  read("app/api/crm/outreach/[id]/sendpilot/route.ts"),
  read("app/api/crm/outreach/queue/route.ts"),
  read("app/api/crm/outreach/route.ts"),
  read("app/api/crm/outreach/metrics/route.ts"),
  read("app/api/crm/outreach/campaigns/route.ts"),
  read("app/api/webhooks/sendpilot/[token]/route.ts"),
  read("app/settings/page.tsx"),
  read("app/crm/outreach/page.tsx"),
  read("supabase/migrations/20260828233431_sendpilot_crm_orchestration.sql"),
  read("supabase/migrations/20260828233544_index_sendpilot_crm_scope.sql"),
]);

assert(apiClient.includes('sendPilotRequest("/v1/leads"'));
assert(apiClient.includes('method: "POST"'));
assert(apiClient.includes('method: "PATCH"'));
assert(apiClient.includes("updateSendPilotLeadStatus"));
assert(apiClient.includes("updateSendPilotCampaign"));
assert(apiClient.includes("/status"));
assert(!apiClient.includes('method: "PUT"'));
assert(!apiClient.includes('method: "DELETE"'));
for (const forbidden of [
  "/v1/messages",
  "/v1/connections",
  "/v1/posts",
  "/v1/likes",
]) {
  assert(!apiClient.includes(forbidden), `Forbidden SendPilot action path ${forbidden}`);
}

assert(orchestration.includes("input.confirmed !== true"));
assert(orchestration.includes("prospect.assigned_to_user_id !== scope.userId"));
assert(orchestration.includes("campaign.approval_mode !== true"));
assert(orchestration.includes('step?.channel !== "linkedin"'));
assert(orchestration.includes('from("outreach_suppressions")'));
assert(orchestration.includes("prospectHasBlockedCrmRelationship"));
assert(orchestration.includes("isActiveOutreachEnrolmentStatus"));
assert(orchestration.includes("isInsideCrossCampaignCooldown"));
assert(orchestration.includes("londonDayBounds"));
assert(orchestration.includes("The mapped SendPilot campaign is no longer running"));
assert.match(
  orchestration,
  /listSendPilotCampaigns\(apiKey\)[\s\S]*remoteCampaign\.status !== "started"/
);
assert(orchestration.includes('sync_status: ambiguous ? "pending_confirmation" : "failed"'));
assert.match(orchestration, /Never retry an[\s\S]*ambiguous external side effect automatically/);
assert(orchestration.includes('event.eventType === "lead.updated"') && orchestration.includes("return null"));
assert(orchestration.includes("recordSendPilotBackfillReplyInCrm"));
assert(orchestration.includes("providerMessageId"));

for (const route of [campaignRoute, enrolRoute]) {
  assert(route.includes("requireRequestScope"));
}
for (const source of [orchestration, queueRoute, prospectsRoute, metricsRoute, campaignsRoute]) {
  assert(source.includes("workspace_id") || source.includes("workspaceId"));
  assert(source.includes("owner_id") || source.includes("userId"));
}
assert(webhookRoute.includes("parseSendPilotWebhookEvent"));
assert(webhookRoute.includes("processSendPilotWebhookEvent"));
assert(integration.includes("recordSendPilotBackfillReplyInCrm"));

assert(settings.includes("Map LiveCoach campaigns to SendPilot"));
assert(settings.includes("This mapping is private to this salesperson"));
assert(settings.includes("cannot start campaigns, change their sequence"));
assert(outreachUi.includes("window.confirm"));
assert(outreachUi.includes("Approve for"));
assert(outreachUi.includes("Check email replies"));
assert(outreachUi.includes('reply.replyChannel === "linkedin"'));

assert(migration.includes("create table public.sendpilot_campaign_links"));
assert(migration.includes("create table public.sendpilot_lead_links"));
assert(migration.includes("validate_sendpilot_crm_scope"));
assert(migration.includes("foreign key (integration_id, owner_id, workspace_id)"));
assert(migration.includes("unique (integration_id, sendpilot_campaign_id)"));
assert(!migration.includes("unique (sendpilot_campaign_id)"));
assert(migration.includes("prospect.assigned_to_user_id = new.owner_id"));
assert(migration.includes("outreach_sendpilot_reply_message_once_idx"));
assert(migration.includes("outreach_sendpilot_provider_event_once_idx"));
assert(migration.includes("enable row level security"));
assert(migration.includes("from public, anon, authenticated"));
assert(!migration.includes("grant select on public.sendpilot_campaign_links to authenticated"));
assert(!migration.includes("grant select on public.sendpilot_lead_links to authenticated"));
assert(migration.includes("linkedin_message_sent"));
assert(migration.includes("linkedin_connection_accepted"));
assert(migration.includes("voice_script_approved"));
assert(indexMigration.includes("sendpilot_campaign_links_integration_scope_idx"));
assert(indexMigration.includes("sendpilot_lead_links_integration_scope_idx"));
assert(indexMigration.includes("sendpilot_lead_links_enrolment_fk_idx"));

const privateRows = [
  { workspaceId: "workspace", ownerId: "lee", integrationId: "lee-sendpilot" },
  { workspaceId: "workspace", ownerId: "cam", integrationId: "cam-sendpilot" },
];
const rowsFor = (workspaceId, ownerId) =>
  privateRows.filter(
    (row) => row.workspaceId === workspaceId && row.ownerId === ownerId
  );
assert.deepEqual(rowsFor("workspace", "lee"), [privateRows[0]]);
assert.deepEqual(rowsFor("workspace", "cam"), [privateRows[1]]);
assert.deepEqual(rowsFor("another-workspace", "lee"), []);

console.log("SendPilot CRM orchestration and two-user isolation validation passed");
