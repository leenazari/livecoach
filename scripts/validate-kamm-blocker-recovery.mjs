import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server.js";

const require = createRequire(import.meta.url);
function compile(file, replacements = {}, extra = "") {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, "utf8") + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)(name => {
    if (name in replacements) return replacements[name];
    if (name === "server-only") return {};
    if (name.startsWith("@/")) return {};
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const id = n => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const alice = id(1), bob = id(2), workspace = id(3), otherWorkspace = id(4), prospect = id(5), integration = id(6);
const scope = { userId: alice, workspaceId: workspace, role: "sales", status: "active" };
const uuid = compile("lib/uuid.ts");
const blockers = compile("lib/crm-blocker.ts");
const db = {
  sendpilot_integrations: [{ id: integration, owner_id: alice, workspace_id: workspace, status: "active" }],
  outreach_prospects: [{ id: prospect, first_name: "Bill", last_name: "Example", assigned_to_user_id: alice, workspace_id: workspace }],
  sendpilot_lead_links: [],
};
const reads = [];
let failTable;
const client = createClient("https://database.invalid", "test-only", { global: { fetch: async (input, init = {}) => {
  assert.ok(["GET", "HEAD"].includes(init.method || "GET"), "Brain preflight cannot mutate data");
  const url = new URL(String(input)), table = url.pathname.split("/").pop();
  reads.push({ table, url });
  if (table === failTable) return Response.json({ code: "READ_FAILED", message: "unavailable" }, { status: 500 });
  const rows = (db[table] || []).filter(row => [...url.searchParams].every(([key, value]) => {
    if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
    if (value.startsWith("ilike.")) return String(row[key] || "").toLowerCase() === value.slice(6).toLowerCase();
    if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
    if (value === "not.is.null") return row[key] != null;
    return true;
  }));
  return Response.json(rows);
} } });
const preflight = compile("lib/brain-sendpilot.ts", {
  "@/lib/supabase": { supabaseService: client }, "@/lib/uuid": uuid,
});
const assistant = compile("app/api/crm/assistant/route.ts", {
  "@/lib/supabase": { supabaseAdmin: client },
  "@/lib/request-scope": { getRequestScope: () => scope },
  "@/lib/brain-sendpilot": preflight,
}, "\nexport { resolveActions, flagUnresolvedActions };\n");
const stop = { type: "sendpilot_stop_lead", prospect: "Bill Example" };
assert.deepEqual(await assistant.resolveActions([stop]), [], "No remote stop button for a native/unlinked prospect");
const unavailable = assistant.flagUnresolvedActions([stop], [])[0];
assert.equal(unavailable.unavailable, true);
assert.match(unavailable.failureReason, /verified lead.*connected SendPilot account/);
const ownLink = { outreach_prospect_id: prospect, workspace_id: workspace, owner_id: alice, integration_id: integration, sendpilot_lead_id: "remote-lead" };
for (const link of [
  { ...ownLink, owner_id: bob }, { ...ownLink, workspace_id: otherWorkspace },
  { ...ownLink, integration_id: id(99) }, { ...ownLink, sendpilot_lead_id: null },
]) {
  db.sendpilot_lead_links = [link];
  assert.deepEqual(await assistant.resolveActions([stop]), [], "Another account, tenant, integration or unsynced link cannot authorize a stop");
}
db.sendpilot_lead_links = [ownLink];
const actions = await assistant.resolveActions([stop]);
assert.equal(actions.length, 1);
assert.equal(actions[0].endpoint, "/api/crm/sendpilot/control");
assert.equal(actions[0].external, true);
assert.equal(actions[0].body.prospectId, prospect);
db.outreach_prospects[0].assigned_to_user_id = bob;
assert.equal((await preflight.loadBrainSendPilotStopTargets(scope, [prospect])).size, 0);
db.outreach_prospects[0].assigned_to_user_id = alice;
db.sendpilot_integrations[0].status = "disconnected";
assert.equal((await preflight.loadBrainSendPilotStopTargets(scope, [prospect])).size, 0);
db.sendpilot_integrations[0].status = "active";
failTable = "sendpilot_lead_links";
await assert.rejects(() => assistant.resolveActions([stop]));
failTable = undefined;
assert.ok(reads.every(({ url }) => url.searchParams.get("workspace_id") === `eq.${workspace}`));

// Old already-rendered action buttons still receive the precise provider
// blocker. No provider call or database mutation is allowed for a missing link.
db.sendpilot_lead_links = [];
let providerCalls = 0;
const service = compile("lib/sendpilot-outreach.ts", {
  "@/lib/supabase": { supabaseService: client },
  "@/lib/sendpilot": { loadSendPilotIntegrationForOwner: async () => db.sendpilot_integrations[0] },
  "@/lib/sendpilot-api": { updateSendPilotLeadStatus: async () => { providerCalls++; } },
});
const control = compile("app/api/crm/sendpilot/control/route.ts", {
  "@/lib/request-scope": { requireRequestScope: () => scope },
  "@/lib/sendpilot-outreach": service, "@/lib/crm-blocker": blockers,
});
const response = await control.POST(new NextRequest("https://crm.test/api/crm/sendpilot/control", {
  method: "POST", body: JSON.stringify({ action: "stop_lead", prospectId: prospect, requestId: id(20), confirmed: true }),
}));
assert.equal(response.status, 404);
const failure = await response.json();
assert.equal(failure.blocker.code, "sendpilot_lead_not_linked");
assert.doesNotMatch(failure.error, /Brain unavailable/);
assert.equal(providerCalls, 0);

// An ordinary rejected Outreach request is now auditable without storing
// its body, query parameters, message text, identity fields or credentials.
const diagnostics = compile("lib/crm-blocker-diagnostics.ts", { "@/lib/uuid": uuid });
for (const url of ["https://evil.test/api/crm/outreach", "/api/crm/blocker-reports", "/api/crm/outreach/person@example.test", "/api/crm/outreach/../companies"]) {
  assert.equal(diagnostics.crmBlockerDiagnostic({ url, code: "crm_outreach_400", status: 400, method: "POST" }), null);
}
const reports = [], browserEvents = [];
globalThis.window = { dispatchEvent: event => browserEvents.push(event) };
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
globalThis.fetch = async (url, init) => {
  if (url === "/api/crm/blocker-reports") {
    reports.push(JSON.parse(init.body)); return Response.json({ ok: true });
  }
  return Response.json({ error: "This person is not in today's queue" }, { status: 400 });
};
const crm = compile("lib/crm.ts", { "@/lib/crm-blocker": blockers, "@/lib/crm-blocker-diagnostics": diagnostics });
const requestUrl = `/api/crm/outreach/${prospect}/prepare?private=never-store`;
await assert.rejects(() => crm.crmFetch(requestUrl, { method: "POST", body: JSON.stringify({ password: "never-store" }) }));
await assert.rejects(() => crm.crmFetch(requestUrl, { method: "POST", body: "{}" }));
assert.equal(reports.length, 1, "Repeated failures are deduplicated without retrying the failed action");
assert.equal(reports[0].reasonCategory, "queue_membership_required");
assert.equal(reports[0].path, requestUrl.split("?")[0]);
assert.equal(browserEvents.length, 2, "Original blockers remain visible");
assert.doesNotMatch(JSON.stringify(reports), /password|never-store|This person/);

let activeScope = scope, rateCount = 0;
const inserted = [];
const auditClient = { from: table => {
  assert.equal(table, "access_audit_events");
  const filters = {};
  const chain = {
    select: () => chain, eq: (key, value) => { filters[key] = value; return chain; }, gte: () => chain,
    then: resolve => {
      assert.equal(filters.workspace_id, workspace); assert.equal(filters.actor_user_id, alice);
      return Promise.resolve({ count: rateCount }).then(resolve);
    },
    insert: async row => { inserted.push(row); return { error: null }; },
  };
  return chain;
} };
const reporter = compile("app/api/crm/blocker-reports/route.ts", {
  "@/lib/request-scope": { getRequestScope: () => activeScope },
  "@/lib/supabase": { supabaseService: auditClient }, "@/lib/crm-blocker-diagnostics": diagnostics,
});
const reportRequest = (body, origin = "https://crm.test") => new NextRequest("https://crm.test/api/crm/blocker-reports", {
  method: "POST", headers: { origin }, body: JSON.stringify(body),
});
assert.equal((await reporter.POST(reportRequest({ ...reports[0], actor_user_id: bob, workspace_id: otherWorkspace, error: "secret" }))).status, 200);
assert.equal(inserted[0].actor_user_id, alice);
assert.equal(inserted[0].workspace_id, workspace);
assert.equal(inserted[0].metadata.reportedBy, "browser");
assert.doesNotMatch(JSON.stringify(inserted), /secret/);
activeScope = null;
assert.equal((await reporter.POST(reportRequest(reports[0]))).status, 403);
activeScope = scope;
assert.equal((await reporter.POST(reportRequest(reports[0], "https://evil.test"))).status, 403);
assert.equal((await reporter.POST(reportRequest({ path: "/api/crm/blocker-reports" }))).status, 400);
assert.equal((await reporter.POST(reportRequest({ text: "x".repeat(3000) }))).status, 413);
rateCount = 20;
assert.equal((await reporter.POST(reportRequest(reports[0]))).status, 429);
assert.equal(inserted.length, 1);
delete globalThis.window;
console.log("Kamm blocker recovery passed: real Brain action resolution, provider account isolation, stale buttons, error UI, private diagnostics and authenticated audit writes.");
