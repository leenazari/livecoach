import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { senderAfterConnectorDisconnect } from "../lib/connector-disconnect-policy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const google = read("lib/google.ts");
const microsoft = read("lib/microsoft.ts");
const reconciliation = read("lib/connector-disconnect.ts");
const googleRoute = read("app/api/auth/google/disconnect/route.ts");
const microsoftRoute = read("app/api/auth/microsoft/disconnect/route.ts");
const settings = read("app/settings/page.tsx");

for (const source of [google, microsoft]) {
  assert.match(source, /refresh_token: null/);
  assert.match(source, /access_token: null/);
  assert.match(source, /\.eq\("owner_id", scope\.userId\)/);
  assert.match(source, /\.eq\("workspace_id", scope\.workspaceId\)/);
}
for (const route of [googleRoute, microsoftRoute]) {
  assert.match(route, /requireRequestScope\(\)/);
  assert.match(route, /reconcileSenderAfterConnectorDisconnect/);
  assert.match(route, /access_audit_events/);
  assert.match(route, /actor_user_id: scope\.userId/);
  assert.match(route, /export async function DELETE\(\)/);
}
assert.match(reconciliation, /\.eq\("owner_id", scope\.userId\)/);
assert.match(reconciliation, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(settings, /aria-label="Disconnect Google"/);
assert.match(settings, /aria-label="Disconnect Microsoft"/);
assert.match(settings, /Yes, disconnect Google/);
assert.match(settings, /Yes, disconnect Microsoft/);
assert.match(settings, /method: "DELETE"/);
assert.match(settings, /microsoft\.status !== "disconnected"/);

assert.deepEqual(
  senderAfterConnectorDisconnect({
    currentSenderEmail: "kamm@interviewa.com",
    disconnectedEmail: "kamm@interviewa.com",
    googleEmail: "kamm@interviewa.com",
  }),
  { provider: "google", senderEmail: "kamm@interviewa.com" }
);
assert.deepEqual(
  senderAfterConnectorDisconnect({
    currentSenderEmail: "lee@interviewa.com",
    disconnectedEmail: "unused@outlook.com",
    googleEmail: "lee@ai13.com",
  }),
  { provider: "google", senderEmail: "lee@interviewa.com" },
  "a verified Gmail send-as alias must survive an unrelated disconnect"
);
assert.deepEqual(
  senderAfterConnectorDisconnect({
    currentSenderEmail: "old@gmail.com",
    disconnectedEmail: "old@gmail.com",
    microsoftEmail: "person@company.com",
  }),
  { provider: "microsoft", senderEmail: "person@company.com" }
);
assert.deepEqual(
  senderAfterConnectorDisconnect({
    currentSenderEmail: "person@company.com",
    disconnectedEmail: "person@company.com",
  }),
  { provider: null, senderEmail: null }
);

console.log("Per-user provider disconnect checks passed");
