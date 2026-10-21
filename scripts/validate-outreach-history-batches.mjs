import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
function compile(file, replacements = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "module", "exports", code)(name => {
    if (name in replacements) return replacements[name];
    if (name.startsWith("@/")) return {};
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const uuid = n => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const workspace = uuid(1), outside = uuid(2), alice = uuid(3), bob = uuid(4), emptyUser = uuid(5);
const ids = Array.from({ length: 716 }, (_, i) => uuid(1000 + i));
const timestamp = i => new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString();
function database(db) {
  const requests = [];
  const client = createClient("https://database.invalid", "test-key", { global: { fetch: async (input, init = {}) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop(), params = url.searchParams;
    requests.push(url);
    assert.ok(["GET", "HEAD"].includes(init.method || "GET"), "History reads must never change records");
    if (url.href.length > 8000) return new Response("Bad Request", { status: 400 });
    if (db.failId && params.get("prospect_id")?.includes(db.failId))
      return Response.json({ message: "Sensitive query detail must not reach UI", code: "TEST_FAILURE" }, { status: 500 });
    let rows = (db[table] || []).filter(row => [...params].every(([key, value]) => {
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
      if (value.startsWith("gte.")) return row[key] >= value.slice(4);
      if (value.startsWith("lt.")) return row[key] < value.slice(3);
      if (value === "not.is.null") return row[key] != null;
      if (value === "is.null") return row[key] == null;
      return true;
    }));
    rows.sort((a, b) => {
      for (const term of (params.get("order") || "").split(",")) {
        const [key, direction] = term.split(".");
        const difference = String(a[key] || "").localeCompare(String(b[key] || "")) * (direction === "desc" ? -1 : 1);
        if (difference) return difference;
      }
      return 0;
    });
    const total = rows.length;
    const offset = Number(params.get("offset")) || 0;
    rows = rows.slice(offset, offset + Math.min(1000, Number(params.get("limit")) || 1000));
    const selected = (params.get("select") || "*").split(",");
    if (!selected.includes("*")) rows = rows.map(row => Object.fromEntries(selected.map(key => [key, row[key]])));
    const headers = { "content-range": `${offset}-${offset + rows.length - 1}/${total}` };
    return init.method === "HEAD" ? new Response(null, { headers }) : Response.json(rows, { headers });
  } } });
  return { client, requests };
}
const helper = compile("lib/scoped-id-rows.ts");
const rows = ids.map((id, i) => ({
  id: uuid(3000 + i), prospect_id: id, workspace_id: workspace, owner_id: alice,
  created_at: timestamp(i), kind: "reply", secret: "Not selected",
}));
rows.push(
  { ...rows[0], id: uuid(5000), workspace_id: outside },
  { ...rows[0], id: uuid(5001), owner_id: bob },
  { ...rows[0], id: uuid(5002), kind: "draft" },
);
const db = { outreach_events: rows };
const { client, requests } = database(db);
const options = {
  table: "outreach_events", columns: "id,prospect_id,created_at", idColumn: "prospect_id",
  ids: [...ids, ids[0]], workspaceId: workspace, orderBy: "created_at", limit: 5000,
  filter: query => query.eq("owner_id", alice).eq("kind", "reply"),
};
const result = await helper.loadScopedIdRows(client, options);
assert.equal(result.length, 716);
assert.equal(result[0].prospect_id, ids.at(-1));
assert.ok(result.every(row => !("secret" in row)));
assert.ok(requests.every(url => url.href.length < 8000 && url.searchParams.get("workspace_id") === `eq.${workspace}`));
assert.ok(requests.every(url => url.searchParams.get("owner_id") === `eq.${alice}`));
const beforeEmpty = requests.length;
assert.deepEqual(await helper.loadScopedIdRows(client, { ...options, ids: [] }), []);
assert.equal(requests.length, beforeEmpty, "Empty authorised IDs cannot widen into a workspace-wide query");
const bobResult = await helper.loadScopedIdRows(client, { ...options, filter: query => query.eq("owner_id", bob) });
assert.deepEqual(bobResult.map(row => row.id), [uuid(5001)]);
const capped = await helper.loadScopedIdRows(client, { ...options, limit: 40 });
assert.equal(capped.length, 40);
assert.deepEqual(capped.map(row => row.id), result.slice(0, 40).map(row => row.id), "Global newest-first limit must apply across all batches");

// A single prospect can have more rows than the default database page.
const paged = database({ outreach_events: Array.from({ length: 1205 }, (_, i) => ({
  ...rows[0], id: uuid(10000 + i), created_at: timestamp(i),
})) });
assert.equal((await helper.loadScopedIdRows(paged.client, { ...options, ids: [ids[0]] })).length, 1205);
assert.ok(paged.requests.some(url => url.searchParams.get("offset") === "1000"));
db.failId = ids[150];
await assert.rejects(() => helper.loadScopedIdRows(client, options), error => error.code === "TEST_FAILURE");
delete db.failId;

const readErrors = compile("lib/crm-read-error.ts", { "@/lib/crm-blocker": compile("lib/crm-blocker.ts") });
// Exercise the actual revenue handler with a deliberately broad fake DB.
// The caller's prospect ownership and workspace must constrain every batch.
const routeDb = {
  outreach_prospects: [
    ...ids.map(id => ({ id, workspace_id: workspace, assigned_to_user_id: alice })),
    { id: uuid(20000), workspace_id: workspace, assigned_to_user_id: bob },
    { id: uuid(20001), workspace_id: outside, assigned_to_user_id: alice },
  ],
};
routeDb.outreach_messages = routeDb.outreach_prospects.map((p, i) => ({
  id: uuid(21000 + i), prospect_id: p.id, workspace_id: p.workspace_id,
  sender_user_id: p.assigned_to_user_id, status: "sent", sent_at: timestamp(i),
}));
routeDb.outreach_events = routeDb.outreach_prospects.map((p, i) => ({
  id: uuid(23000 + i), prospect_id: p.id, workspace_id: p.workspace_id,
  owner_id: p.assigned_to_user_id, kind: "reply", created_at: timestamp(i),
}));
const routeDatabase = database(routeDb);
let actor = alice;
const route = compile("app/api/crm/revenue/route.ts", {
  "next/server": { NextResponse: { json: (data, options) => Response.json(data, options) } },
  "@/lib/supabase": { supabaseAdmin: routeDatabase.client, supabaseService: routeDatabase.client },
  "@/lib/request-scope": { requireRequestScope: () => ({ userId: actor, workspaceId: workspace, role: "sales" }) },
  "@/lib/team-lead-cover": { teamLeadCoverEnabled: async () => false },
  "@/lib/app-config": { getAppConfigRows: async () => [] },
  "@/lib/opportunity-access": { loadVisibleOpportunities: async () => [] },
  "@/lib/team-client-sharing": { activeSharedClientIds: async () => [], loadSafeSharedCompanies: async () => [] },
  "@/lib/company-pipeline-exclusion": { companyPipelineExclusionIds: () => new Set() },
  "@/lib/opportunity-fields": { WIN_OUTLOOKS: [] },
  "@/lib/scoped-id-rows": helper,
  "@/lib/crm-read-error": readErrors,
});
for (const [user, count] of [[alice, 716], [bob, 1], [emptyUser, 0]]) {
  actor = user;
  const response = await route.GET();
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.funnel.find(row => row.key === "contacted").value, count);
  assert.equal(payload.funnel.find(row => row.key === "replied").value, count);
}
assert.ok(routeDatabase.requests.every(url => url.href.length < 8000));
actor = alice;
routeDb.failId = ids[150];
const logs = [], originalError = console.error;
console.error = (...args) => logs.push(args);
try {
  const failed = await route.GET();
  const payload = await failed.json();
  assert.equal(failed.status, 500, "Incomplete reporting must fail explicitly rather than claim zero activity");
  assert.equal(payload.blocker.code, "crm_read_failed");
  assert.match(payload.error, /Retry this list/);
  assert.doesNotMatch(JSON.stringify(payload), /Sensitive query detail/);
  assert.doesNotMatch(JSON.stringify(logs), /Sensitive query detail|owner_id|prospect_id/);
  assert.equal(logs[0][1].code, "TEST_FAILURE");
} finally {
  console.error = originalError;
}
delete routeDb.failId;
for (let i = 100; i < 300; i++) routeDb.outreach_events.push({
  id: uuid(25000 + i), prospect_id: ids[i], workspace_id: workspace, owner_id: alice,
  kind: i < 200 ? "manual_call" : "linkedin_message_sent", created_at: timestamp(i), metadata: {},
});
const metricsRoute = compile("app/api/crm/outreach/metrics/route.ts", {
  "next/server": { NextResponse: { json: (data, options) => Response.json(data, options) } },
  "@/lib/supabase": { supabaseAdmin: routeDatabase.client },
  "@/lib/request-scope": { requireRequestScope: () => ({ userId: actor, workspaceId: workspace, role: "sales" }) },
  "@/lib/outreach": { londonDayBounds: () => ({ start: "2026-01-01", end: "2027-01-01" }) },
  "@/lib/scoped-id-rows": helper,
  "@/lib/crm-read-error": readErrors,
});
for (const [user, count] of [[alice, 100], [bob, 1], [emptyUser, 0]]) {
  actor = user;
  const response = await metricsRoute.GET({ nextUrl: new URL("https://crm.invalid/api/crm/outreach/metrics") });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.sentHistory.length, count);
  assert.ok(payload.sentHistory.every(row => row.prospect?.id === row.prospect_id));
  assert.equal(payload.manualCalls.length, user === alice ? 100 : 0);
  assert.equal(payload.sendPilotActivity.length, user === alice ? 100 : 0);
  assert.ok([...payload.manualCalls, ...payload.sendPilotActivity].every(row => row.prospect?.id === row.prospect_id));
}
assert.ok(routeDatabase.requests.every(url => url.href.length < 8000));
console.log("Scoped history batching passed. 716 leads, two-user/workspace isolation, empty input, projection, pagination, global limits, real revenue and metrics handlers and safe errors verified.");
