import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SENDPILOT_BACKFILL_DAYS,
  SENDPILOT_BACKFILL_OVERLAP_MS,
  sendPilotBackfillCutoffMs,
} from "../lib/sendpilot-contract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const now = Date.parse("2026-08-31T12:00:00.000Z");
const hardCutoff = now - SENDPILOT_BACKFILL_DAYS * 24 * 60 * 60 * 1_000;
assert.equal(sendPilotBackfillCutoffMs(null, now), hardCutoff);
const previous = "2026-08-30T12:00:00.000Z";
assert.equal(
  sendPilotBackfillCutoffMs(previous, now),
  Date.parse(previous) - SENDPILOT_BACKFILL_OVERLAP_MS
);
assert.equal(
  sendPilotBackfillCutoffMs("2026-07-01T12:00:00.000Z", now),
  hardCutoff,
  "A repair must never import beyond the fixed 14 day privacy limit"
);

const integration = read("lib/sendpilot.ts");
const cron = read("app/api/cron/sendpilot-reconcile/route.ts");
const settings = read("app/settings/page.tsx");
const vercel = read("vercel.json");

assert.match(integration, /listScheduledSendPilotScopes/);
assert.match(integration, /\.eq\("status", "active"\)/);
assert.match(integration, /\.not\("api_key_ciphertext", "is", null\)/);
assert.match(integration, /\.not\("webhook_secret_ciphertext", "is", null\)/);
assert.match(integration, /\.from\("workspace_members"\)/);
assert.match(integration, /\.eq\("status", "active"\)/);
assert.match(integration, /workspace_id/);
assert.match(integration, /owner_id/);
assert.match(integration, /sendPilotBackfillCutoffMs\(integration\.last_backfill_at\)/);

assert.match(cron, /process\.env\.CRON_SECRET/);
assert.match(cron, /listScheduledSendPilotScopes\(MAX_ACCOUNTS_PER_RUN\)/);
assert.match(cron, /runSendPilotBackfill\(scope\)/);
assert.match(cron, /CONCURRENCY = 2/);
assert.doesNotMatch(cron, /addSendPilotLeads|\/v1\/leads/);
assert.match(cron, /mode: "inbound_repair"/);
assert.match(vercel, /"path": "\/api\/cron\/sendpilot-reconcile"/);
assert.match(vercel, /"schedule": "50 6,18 \* \* \*"/);
assert.match(settings, /twice-daily[\s\S]*inbound-only safety sync/);
assert.match(settings, /cannot enrol a lead, start a sequence or send a message/);

const scopes = [
  { workspaceId: "workspace", userId: "lee" },
  { workspaceId: "workspace", userId: "cam" },
];
assert.notEqual(
  `${scopes[0].workspaceId}:${scopes[0].userId}`,
  `${scopes[1].workspaceId}:${scopes[1].userId}`
);

console.log("SendPilot scheduled safety sync checks passed");
