import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const modules = new Map();
let scope = { userId: "lee", workspaceId: "workspace-one", status: "active" };
let failDatabase = false;
const rows = [
  { owner_id: "lee", workspace_id: "workspace-one", visibility: "private", key: "google_meet_account_email", value: "lee@ai13.com" },
  { owner_id: "kam", workspace_id: "workspace-one", visibility: "private", key: "google_meet_account_email", value: "kam@example.com" },
  { owner_id: "owner", workspace_id: "workspace-two", visibility: "team", key: "google_meet_account_email", value: "wrong@example.com" },
  { owner_id: "owner", workspace_id: "workspace-one", visibility: "team", key: "google_meet_account_email", value: "wrong@example.com" },
];
const db = { from(table) {
  assert.equal(table, "app_config");
  const filters = [];
  let mutation;
  const query = {
    select() { return query; },
    eq(key, value) { filters.push([key, value]); return query; },
    limit() { return query; },
    update(value) { mutation = { update: value }; return query; },
    insert(value) { mutation = { insert: value }; return query; },
    async maybeSingle() { return query.single(); },
    async single() {
      if (failDatabase) return { data: null, error: new Error("database unavailable") };
      if (mutation?.insert) rows.push(mutation.insert);
      const match = mutation?.insert || rows.find(row => filters.every(([key, value]) => row[key] === value));
      if (match && mutation?.update) Object.assign(match, mutation.update);
      return { data: match || null, error: null };
    },
  };
  return query;
} };
const requestScope = () => {
  if (!scope) throw new Error("authentication required");
  return scope;
};
const replacements = {
  "server-only": {},
  "@/lib/request-scope": { requireRequestScope: requestScope, getRequestScope: requestScope },
  "@/lib/record-scope": { resolveRecordScope: async () => requestScope() },
  "@/lib/supabase": { supabaseService: db },
};
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const source = readFileSync(new URL(file, root), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", compiled)(name => {
    if (name in replacements) return replacements[name];
    if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
    return require(name);
  }, module, module.exports);
  return module.exports;
}

const helper = load("lib/meeting-account.ts");
const canonical = "https://meet.google.com/abc-defg-hij?authuser=0&hs=122#join";
const launch = new URL(helper.withGoogleMeetingAccount(canonical, " Lee@AI13.com "));
assert.equal(launch.searchParams.get("authuser"), "lee@ai13.com");
assert.equal(launch.searchParams.get("hs"), "122");
assert.equal(launch.hash, "#join");
assert.equal(launch.searchParams.getAll("authuser").length, 1);
assert.equal(helper.withGoogleMeetingAccount(canonical, ""), canonical);
assert.equal(helper.withGoogleMeetingAccount(canonical, null), canonical);
assert.equal(helper.withGoogleMeetingAccount(canonical, "not an email"), canonical);
for (const url of ["https://teams.microsoft.com/l/meetup-join/a", "https://company.zoom.us/j/123"])
  assert.equal(helper.browserMeetingLaunchUrl(url), url);
for (const url of ["https://meet.google.com.evil.test/a", "https://evil.meet.google.com/a", "javascript:alert(1)", "https://lee@meet.google.com/a", "http://meet.google.com/a", "https://meet.google.com:999/a", "//meet.google.com/a"])
  assert.equal(helper.isGoogleMeetLaunchUrl(url), false, url);

const openRoute = load("app/api/meet/open/route.ts");
const preferences = load("app/api/crm/meeting-preferences/route.ts");
const req = (url = canonical) => ({ nextUrl: new URL(`https://crm.test/api/meet/open?url=${encodeURIComponent(url)}`) });
let response = await openRoute.GET(req());
assert.equal(response.status, 307);
assert.equal(new URL(response.headers.get("location")).searchParams.get("authuser"), "lee@ai13.com");
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal(response.headers.get("referrer-policy"), "no-referrer");
assert.equal((await openRoute.GET(req("https://evil.test"))).status, 400);

scope = { ...scope, userId: "kam" };
response = await openRoute.GET(req());
assert.equal(new URL(response.headers.get("location")).searchParams.get("authuser"), "kam@example.com");
scope = { ...scope, userId: "sharon" };
assert.equal((await openRoute.GET(req())).headers.get("location"), canonical, "No fallback to Lee or team config");
scope = { ...scope, userId: "lee", workspaceId: "workspace-two" };
assert.equal((await openRoute.GET(req())).headers.get("location"), canonical, "No cross-workspace preference");

for (const status of ["onboarding", "removed", "suspended"]) {
  scope = { ...scope, workspaceId: "workspace-one", status };
  assert.equal((await preferences.GET()).status, 403);
  assert.equal((await preferences.PUT({ json: async () => ({ googleMeetEmail: "lee@ai13.com" }) })).status, 403);
  assert.equal((await openRoute.GET(req())).headers.get("location"), null);
}
scope = null;
assert.equal((await preferences.GET()).status, 403);
assert.equal((await openRoute.GET(req())).headers.get("location"), null);
scope = { userId: "lee", workspaceId: "workspace-one", status: "active" };
const put = body => preferences.PUT({ json: async () => body });
for (const body of [null, [], {}, { googleMeetEmail: 4 }, { googleMeetEmail: "bad" }, { googleMeetEmail: "a@b.com", owner_id: "kam" }, { googleMeetEmail: "a@b.com", visibility: "team" }])
  assert.equal((await put(body)).status, 400);
response = await put({ googleMeetEmail: " LEE@AI13.COM " });
assert.deepEqual(await response.json(), { ok: true, googleMeetEmail: "lee@ai13.com" });
assert.equal(rows.find(row => row.owner_id === "kam").value, "kam@example.com");
response = await put({ googleMeetEmail: "" });
assert.deepEqual(await response.json(), { ok: true, googleMeetEmail: "" });
assert.equal((await openRoute.GET(req())).headers.get("location"), canonical);
failDatabase = true;
assert.equal((await openRoute.GET(req())).headers.get("location"), null, "Read errors cannot silently select the wrong account");
assert.equal((await put({ googleMeetEmail: "lee@ai13.com" })).status, 503);

// The one-use bot launch marker must keep the canonical URL, not the browser
// redirect or account hint. No extra clicks / asynchronous popup are needed.
const storage = new Map();
const opened = [];
globalThis.window = {
  sessionStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
  open: (...args) => opened.push(args),
};
const armed = load("lib/call-launch.ts");
assert.equal(armed.openAndArmCallLaunch("upcoming-one", canonical), true);
assert.equal(opened[0][0], helper.browserMeetingLaunchUrl(canonical));
assert.equal(armed.consumeArmedCallLaunch("upcoming-two", canonical), false);
assert.equal(armed.openAndArmCallLaunch("upcoming-one", canonical), true);
assert.equal(armed.consumeArmedCallLaunch("upcoming-one", canonical), true);
assert.equal(armed.consumeArmedCallLaunch("upcoming-one", canonical), false);
delete globalThis.window;
console.log("Personal Google Meet launch, persistence, account isolation and canonical-link checks passed");
