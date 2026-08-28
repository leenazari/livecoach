import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import {
  LINKEDIN_INBOX_MAX_LOOKBACK_DAYS,
  LinkedInInboxContractError,
  normaliseLinkedInProfileUrl,
  normaliseStoredLinkedInProfileUrl,
  parseLinkedInInboxBatch,
} from "../lib/linkedin-inbox-contract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const now = Date.parse("2026-08-28T18:00:00.000Z");
assert.equal(
  LINKEDIN_INBOX_MAX_LOOKBACK_DAYS,
  14,
  "The server must never import more than the previous two weeks"
);
assert.equal(
  normaliseLinkedInProfileUrl(
    "https://www.linkedin.com/in/Example-Person/?trk=messaging"
  ),
  "https://www.linkedin.com/in/Example-Person",
  "Tracking parameters must be removed from the canonical identity"
);
assert.equal(
  normaliseLinkedInProfileUrl("https://linkedin.com/in/Example-Person/"),
  "https://www.linkedin.com/in/Example-Person"
);
assert.equal(normaliseLinkedInProfileUrl("https://evil.example/in/person"), null);
assert.equal(
  normaliseLinkedInProfileUrl("https://uk.linkedin.com/in/Example-Person"),
  "https://www.linkedin.com/in/Example-Person"
);
assert.equal(
  normaliseStoredLinkedInProfileUrl(
    "http://www.linkedin.com/in/Example-Person/?trk=legacy"
  ),
  "https://www.linkedin.com/in/Example-Person",
  "Legacy outreach URLs must still resolve to the exact canonical profile"
);

const batch = parseLinkedInInboxBatch(
  {
    runId: "run_20260828_a1",
    capturedAt: "2026-08-28T18:00:00.000Z",
    conversationCount: 1,
    messages: [
      {
        direction: "inbound",
        conversationId: "conversation-1",
        messageId: "urn:li:msg_message:message-1",
        senderName: "Example Person",
        senderProfileUrl: "https://www.linkedin.com/in/example-person",
        body: "Could we book a demo?",
        receivedAt: "2026-08-28T17:30:00.000Z",
      },
      {
        direction: "inbound",
        conversationId: "conversation-1",
        messageId: "urn:li:msg_message:message-1",
        senderName: "Example Person",
        senderProfileUrl: "https://www.linkedin.com/in/example-person",
        body: "Duplicate copy",
        receivedAt: "2026-08-28T17:30:00.000Z",
      },
      {
        direction: "inbound",
        conversationId: "conversation-1",
        messageId: "urn:li:msg_message:old-message",
        senderName: "Example Person",
        senderProfileUrl: "https://www.linkedin.com/in/example-person",
        body: "Older than the configured lookback.",
        receivedAt: "2026-07-01T09:00:00.000Z",
      },
    ],
  },
  { maxConversations: 10, lookbackDays: 14 },
  now
);
assert.equal(batch.messages.length, 1, "Duplicate and out-of-window messages must be removed");
assert.equal(batch.messages[0].direction, "inbound");

const hardLookbackBatch = parseLinkedInInboxBatch(
  {
    runId: "run_20260828_two_week_cap",
    capturedAt: "2026-08-28T18:00:00.000Z",
    conversationCount: 1,
    messages: [
      {
        direction: "inbound",
        conversationId: "conversation-1",
        messageId: "message-before-two-week-window",
        senderName: "Example Person",
        senderProfileUrl: "https://www.linkedin.com/in/example-person",
        body: "This must remain outside the CRM.",
        receivedAt: "2026-08-10T17:30:00.000Z",
      },
    ],
  },
  { maxConversations: 10, lookbackDays: 30 },
  now
);
assert.equal(
  hardLookbackBatch.messages.length,
  0,
  "Even a caller requesting 30 days must be clamped to the two-week maximum"
);

assert.throws(
  () =>
    parseLinkedInInboxBatch(
      {
        runId: "run_20260828_b2",
        capturedAt: "2026-08-28T18:00:00.000Z",
        conversationCount: 1,
        messages: [
          {
            direction: "outbound",
            conversationId: "conversation-1",
            messageId: "message-2",
            senderName: "Lee",
            senderProfileUrl: "https://www.linkedin.com/in/lee",
            body: "This must never import.",
            receivedAt: "2026-08-28T17:30:00.000Z",
          },
        ],
      },
      { maxConversations: 10, lookbackDays: 14 },
      now
    ),
  (error) =>
    error instanceof LinkedInInboxContractError &&
    error.message === "Only inbound messages are accepted"
);

assert.throws(
  () =>
    parseLinkedInInboxBatch(
      {
        runId: "run_20260828_c3",
        capturedAt: "2026-08-28T18:00:00.000Z",
        conversationCount: 1,
        messages: [
          {
            direction: "inbound",
            conversationId: "conversation-1",
            messageId: "message-3",
            senderName: "Example Person",
            senderProfileUrl: "https://www.linkedin.com/in/example-person",
            body: "First conversation",
            receivedAt: "2026-08-28T17:30:00.000Z",
          },
          {
            direction: "inbound",
            conversationId: "conversation-2",
            messageId: "message-4",
            senderName: "Second Person",
            senderProfileUrl: "https://www.linkedin.com/in/second-person",
            body: "Hidden extra conversation",
            receivedAt: "2026-08-28T17:31:00.000Z",
          },
        ],
      },
      { maxConversations: 10, lookbackDays: 14 },
      now
    ),
  (error) =>
    error instanceof LinkedInInboxContractError &&
    error.message ===
      "conversationCount is smaller than the imported conversation set"
);

const manifest = JSON.parse(
  await read("tools/linkedin-inbox-connector/manifest.json")
);
assert.deepEqual(manifest.permissions.sort(), ["activeTab", "storage"]);
assert(!manifest.permissions.includes("cookies"), "The extension must never request cookie access");
assert.deepEqual(manifest.host_permissions.sort(), [
  "https://www.linkedin.com/*",
  "https://www.livecoachcrm.com/*",
]);

const [
  content,
  background,
  migration,
  importRoute,
  importer,
  managementRoute,
  twoWeekMigration,
  privacy,
] = await Promise.all([
  read("tools/linkedin-inbox-connector/content.js"),
  read("tools/linkedin-inbox-connector/background.js"),
  read("supabase/migrations/20260828180413_linkedin_inbox_connector.sql"),
  read("app/api/connectors/linkedin-inbox/import/route.ts"),
  read("lib/linkedin-inbox.ts"),
  read("app/api/crm/linkedin-inbox/route.ts"),
  read("supabase/migrations/20260828202426_linkedin_inbox_two_week_limit.sql"),
  read("app/privacy/page.tsx"),
]);
assert(!content.includes("fetch("), "LinkedIn page capture must not transmit data itself");
assert(!background.includes("api.linkedin.com"), "The local connector must not call private LinkedIn APIs");
assert(background.includes("credentials: \"omit\""));
assert(importRoute.includes("chromeExtensionOriginFromId"));
assert(importRoute.includes("connector authentication failed"));
assert(importer.includes('.ilike("person_linkedin_url"'));
assert(importer.includes('reviewReason: "duplicate_crm_contacts"'));
assert(importer.includes("LINKEDIN_INBOX_MAX_MESSAGES_PER_24_HOURS"));
assert(migration.includes("alter table public.linkedin_inbox_messages enable row level security"));
assert(migration.includes("revoke all on public.linkedin_inbox_connectors from public, anon, authenticated"));
assert(migration.includes("unique (owner_id, provider_message_id)"));
assert(privacy.includes("optional local Chrome connector"));
assert(!content.includes("messages: unique.slice"));
assert(content.includes("More than 200 recent inbound messages were found"));
assert(content.includes("storageKey: threadId"));
assert(content.includes("Math.min(\n    14,"));
assert(managementRoute.includes("LINKEDIN_INBOX_MAX_LOOKBACK_DAYS"));
assert(twoWeekMigration.includes("lookback_days between 1 and 14"));

const encodedTimestamp = Buffer.from(
  "1787938200000b00000-100&synthetic-message-id",
  "utf8"
).toString("base64");
const sandbox = {
  URL,
  Date,
  atob,
  setTimeout,
  clearTimeout,
  window: { location: { origin: "https://www.linkedin.com" } },
  chrome: { runtime: { onMessage: { addListener() {} } } },
};
vm.runInNewContext(
  `${content}\n;globalThis.__livecoachTest = { timestampFromEvent, canonicalProfileUrl };`,
  sandbox
);
const testApi = sandbox.__livecoachTest;
assert.equal(
  testApi.timestampFromEvent(
    { querySelector: () => null },
    `urn:li:msg_message:(urn:li:fsd_profile:synthetic,2-${encodedTimestamp})`
  ),
  "2026-08-28T17:30:00.000Z",
  "The stable LinkedIn event identity must yield its exact message timestamp"
);
assert.equal(
  testApi.canonicalProfileUrl(
    "https://www.linkedin.com/in/ACoAAASynthetic-CaseSensitive"
  ),
  "https://www.linkedin.com/in/ACoAAASynthetic-CaseSensitive",
  "Opaque LinkedIn profile identifiers must preserve case"
);

console.log("LinkedIn inbox connector validation passed");
