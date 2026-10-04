import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as crypto from "node:crypto";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/calendar-watches.ts", import.meta.url), "utf8");
let scope = { userId: "alice", workspaceId: "workspace-a" };
let connection = { provider: "google", email: "alice@example.test" };
let failCreate = false;
const rows = [], requests = [], reads = [];
const db = { from(table) {
  assert.equal(table, "calendar_notification_channels");
  const predicates = []; const filters = [];
  let insert, patch;
  const builder = {
    select() { return this; },
    insert(value) { insert = value; return this; },
    update(value) { patch = value; return this; },
    eq(k,v) { predicates.push(r => r[k] === v); filters.push([k,v]); return this; },
    in(k,v) { predicates.push(r => v.includes(r[k])); return this; },
    order() { return this; },
    then(resolve) {
      if (insert) { rows.unshift({ ...insert, created_at: new Date().toISOString() }); return resolve({ error: null }); }
      reads.push(filters);
      const data = rows.filter(r => predicates.every(p => p(r)));
      if (patch) data.forEach(r => Object.assign(r, patch));
      return resolve({ data: data.map(r => ({ ...r })), error: null });
    },
  };
  return builder;
}};
const environment = { VERCEL_ENV: "production" };
const mockFetch = async (url, init) => {
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ url, method: init.method, body, auth: init.headers.Authorization });
  if (url.endsWith("/watch") || (url.endsWith("/subscriptions") && init.method === "POST")) {
    const pending = rows.find(r => r.status === "pending" && r.owner_id === scope.userId);
    assert.ok(pending, "Routing record exists before provider can deliver an early notification");
    assert.equal(pending.workspace_id, scope.workspaceId);
    assert.equal(pending.token_hash.length, 64);
    assert.notEqual(pending.token_hash, body.token || body.clientState, "Only hashes are persisted");
    if (failCreate) return new Response("", { status: 503 });
    return Response.json(url.includes("googleapis")
      ? { id: body.id, resourceId: `resource-${body.id}`, expiration: Date.now() + 7 * 86400000 }
      : { id: "ms-sub", expirationDateTime: body.expirationDateTime });
  }
  if (init.method === "PATCH") return Response.json({ id: "ms-sub", expirationDateTime: body.expirationDateTime });
  if (init.method === "DELETE" || url.endsWith("/channels/stop")) return new Response(null, { status: 204 });
  throw new Error(`Unexpected provider request ${url}`);
};
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports, process: { env: environment }, fetch: mockFetch, Date, AbortSignal, console,
  require(name) {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    if (name.endsWith("calendar-notification-auth")) return { calendarNotificationHash: value => crypto.createHash("sha256").update(value).digest("hex") };
    if (name.endsWith("calendar-provider")) return { connectedCalendarProvider: async (id) => { assert.equal(id, scope.userId); return connection; } };
    if (name.endsWith("google")) return {
      getAccessToken: async (_, owner) => { assert.equal(owner, scope.userId); return `google-${owner}`; },
      listCalendars: async () => [{ id: "primary-id", primary: true, accessRole: "owner" }, { id: "shared-id", accessRole: "reader" }, { id: "uk#holiday", accessRole: "reader" }],
    };
    if (name.endsWith("microsoft")) return { getMicrosoftAccessToken: async (_, owner) => { assert.equal(owner, scope.userId); return `ms-${owner}`; } };
    if (name.endsWith("public-app-url")) return { publicAppOrigin: () => "https://example.test" };
    if (name.endsWith("record-scope")) return { resolveRecordScope: async () => scope };
    if (name.endsWith("supabase")) return { supabaseService: db };
    throw new Error(`Unexpected dependency ${name}`);
  },
});
const ensure = exports.ensureCalendarWatches;
let result = await ensure();
assert.equal(result.active, 3, "Primary, shared calendar and calendar-list additions are watched");
assert.equal(requests.filter(r => r.url.endsWith("/watch")).length, 3);
const originalCount = requests.length;
result = await ensure();
assert.equal(result.changed, 0);
assert.equal(requests.length, originalCount, "Healthy subscriptions are not recreated each sync");
assert.ok(reads.every(filters => filters.some(([k,v]) => k === "owner_id" && v === "alice") && filters.some(([k,v]) => k === "workspace_id" && v === "workspace-a")));

const old = rows.find(r => r.calendar_id === "primary-id");
old.expires_at = new Date(Date.now() + 60000).toISOString();
requests.length = 0;
await ensure();
assert.ok(requests[0].url.endsWith("/watch"));
assert.ok(requests[1].url.endsWith("/channels/stop"), "Renewal creates replacement before retiring old Google channel");
assert.equal(old.status, "stopped");

scope = { userId: "bob", workspaceId: "workspace-a" };
connection = { provider: "microsoft", email: "bob@example.test" };
requests.length = 0;
await ensure();
assert.equal(requests.length, 1);
assert.equal(requests[0].body.changeType, "created,updated,deleted");
assert.equal(requests[0].body.resource, "/me/events");
assert.match(requests[0].auth, /ms-bob/);
const microsoft = rows.find(r => r.owner_id === "bob");
microsoft.needs_renewal = true;
requests.length = 0;
await ensure();
assert.equal(requests[0].method, "PATCH", "Lifecycle renewal also reauthorizes without duplicate subscriptions");
assert.equal(microsoft.needs_renewal, false);
assert.ok(rows.filter(r => r.owner_id === "alice" && r.status === "active").length === 3, "Bob never changes Alice's subscriptions");

environment.VERCEL_ENV = "preview";
requests.length = 0;
assert.equal((await ensure()).disabled, true);
assert.equal(requests.length, 0, "Previews cannot create real calendar subscriptions");
environment.VERCEL_ENV = "production";
scope = { userId: "charlie", workspaceId: "workspace-b" };
connection = { provider: "google", email: "charlie@example.test" };
failCreate = true;
result = await ensure();
assert.equal(result.failed, 3);
assert.equal(result.active, 0, "Failed provider creation is not reported as connected");
console.log("Google and Microsoft watch setup, renewal, preview safety and per-account provider credentials passed");
