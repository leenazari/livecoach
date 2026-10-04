import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/calendar-sync-jobs.ts", import.meta.url), "utf8");
const environment = { VERCEL_ENV: "production", CRON_SECRET: "test-only-service-credential" };
const requests = [];
let status = 202;
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText, {
  exports, process: { env: environment }, AbortSignal,
  fetch: async (url, init) => { requests.push({ url, init }); return new Response(null, { status }); },
  require(name) {
    if (name === "server-only") return {};
    if (name.endsWith("supabase")) return { supabaseService: {} };
    if (name.endsWith("public-app-url")) return {
      publicAppOrigin: () => "https://www.livecoachcrm.com",
      internalAppOrigin: () => "https://deployment-protected.example.test",
    };
    throw new Error(`Unexpected dependency ${name}`);
  },
});

const scope = { userId: "alice", workspaceId: "workspace-a" };
await exports.kickCalendarSync(scope);
assert.equal(requests[0].url, "https://www.livecoachcrm.com/api/crm/calendar-sync?pending=1",
  "Production dispatch uses the canonical app, not an SSO-protected deployment URL");
assert.equal(requests[0].init.redirect, "error", "Service credentials must never follow redirects");
assert.equal(requests[0].init.cache, "no-store");
assert.deepEqual(JSON.parse(requests[0].init.body), scope);
assert.equal(requests[0].init.headers.Authorization, "Bearer test-only-service-credential");
assert.deepEqual(Object.keys(requests[0].init.headers).sort(), ["Authorization", "Content-Type"],
  "Dispatch forwards neither browser cookies nor user-supplied identity headers");

environment.VERCEL_ENV = "preview";
await exports.kickCalendarSync({ userId: "bob", workspaceId: "workspace-b" });
assert.equal(requests[1].url, "https://deployment-protected.example.test/api/crm/calendar-sync?pending=1",
  "A preview must never dispatch work into production");
assert.deepEqual(JSON.parse(requests[1].init.body), { userId: "bob", workspaceId: "workspace-b" });
status = 401;
await assert.rejects(() => exports.kickCalendarSync(scope), /Calendar worker failed \(401\)/);
delete environment.CRON_SECRET;
const requestCount = requests.length;
await assert.rejects(() => exports.kickCalendarSync(scope), /Calendar worker is not configured/);
assert.equal(requests.length, requestCount, "Missing credentials fail before dispatch");
console.log("Calendar worker production routing, preview isolation and service authentication checks passed");
