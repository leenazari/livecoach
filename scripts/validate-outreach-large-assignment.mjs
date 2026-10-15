import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const uuid = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const alice = uuid(1), bob = uuid(2), emptyUser = uuid(3);
const workspace = uuid(4), outside = uuid(5), campaignId = uuid(6);
const today = "2026-10-15";

function compile(file, replacements) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file });
  run((name) => {
    if (name === "server-only") return {};
    if (name in replacements) return replacements[name];
    if (name.startsWith("@/")) return {};
    return require(name);
  }, module, module.exports);
  return module.exports;
}

// Exercise actual supabase-js URLs against a broad fake database with no RLS.
// Application filters must protect both people and workspaces on their own.
function databaseClient(db) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    const params = url.searchParams;
    const method = init.method || "GET";
    requests.push({ url, method, table });
    if (url.href.length > 8_000) return new Response("Bad Request", { status: 400 });
    if (db.failProspect && params.get("outreach_prospect_id")?.includes(db.failProspect)) {
      return Response.json({ message: "A batch failed" }, { status: 500 });
    }
    let rows = (db[table] || []).filter((row) => {
      for (const [key, value] of params) {
        if (["select", "order", "limit", "offset", "or"].includes(key)) continue;
        const related = key.startsWith("outreach_prospects.")
          ? db.outreach_prospects.find((p) => p.id === row.prospect_id)
          : null;
        const actual = related ? related[key.split(".")[1]] : row[key];
        if (value.startsWith("eq.") && String(actual) !== value.slice(3)) return false;
        if (value.startsWith("in.(") && !value.slice(4, -1).split(",").includes(String(actual))) return false;
        if (value.startsWith("lte.") && (!actual || actual > value.slice(4))) return false;
      }
      const or = params.get("or");
      if (or?.includes("assigned_to_user_id.is.null")) {
        const owner = or.match(/assigned_to_user_id\.eq\.([0-9a-f-]+)/)?.[1];
        if (row.assigned_to_user_id && row.assigned_to_user_id !== owner) return false;
      }
      return true;
    });
    const [sortKey, direction] = (params.get("order") || "").split(".");
    if (sortKey) rows.sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])) * (direction === "desc" ? -1 : 1));
    rows = rows.slice(0, Number(params.get("limit")) || Infinity);
    if (method === "PATCH") {
      const values = JSON.parse(init.body);
      rows.forEach((row) => Object.assign(row, values));
      return new Response(null, { status: 204 });
    }
    assert.equal(method, "GET", "This regression must never send or create outreach");
    return Response.json(structuredClone(rows));
  };
  return { client: createClient("https://database.invalid", "test-key", { global: { fetch } }), requests };
}

function queueFixtures() {
  const prospects = Array.from({ length: 640 }, (_, index) => ({
    id: uuid(1_000 + index), workspace_id: workspace, assigned_to_user_id: alice,
    status: "contacted", company_name: "Assigned company", priority_score: 0,
  }));
  prospects.push(
    { id: uuid(2_000), workspace_id: workspace, assigned_to_user_id: bob, status: "contacted" },
    { id: uuid(2_001), workspace_id: outside, assigned_to_user_id: alice, status: "contacted" },
  );
  const enrolment = (id, prospectId, nextAction, extra = {}) => ({
    id: uuid(id), prospect_id: uuid(prospectId), workspace_id: workspace,
    campaign_id: campaignId, status: "contacted", queued_for: null,
    current_step: 2, next_action_at: nextAction, created_at: "2026-10-01", ...extra,
  });
  return {
    outreach_prospects: prospects,
    outreach_enrolments: [
      enrolment(3_000, 1_000, "2020-01-02"),
      enrolment(3_001, 1_001, "2020-01-01"),
      enrolment(3_002, 2_000, "2019-01-01"),
      enrolment(3_003, 2_001, "2018-01-01", { workspace_id: outside }),
      enrolment(3_004, 1_002, "2099-01-01"),
      enrolment(3_005, 1_003, "2017-01-01", { campaign_id: uuid(7) }),
    ],
    outreach_campaigns: [{ id: campaignId, status: "active", daily_limit: 1 }],
  };
}

for (const [userId, expectedId] of [[alice, uuid(3_001)], [bob, uuid(3_002)], [emptyUser, null]]) {
  const db = queueFixtures();
  const { client, requests } = databaseClient(db);
  const scope = { userId, workspaceId: workspace };
  const route = compile("app/api/crm/outreach/queue/route.ts", {
    "next/server": { NextResponse: { json: (data, options) => Response.json(data, options) } },
    "@/lib/supabase": { supabaseAdmin: client },
    "@/lib/record-scope": { resolveRecordScope: async () => scope },
    "@/lib/request-scope": { getRequestScope: () => ({ ...scope, role: "sales" }) },
    "@/lib/outreach-campaign-selection": { resolveOutreachCampaignSelection: async () => ({ campaign: db.outreach_campaigns[0] }) },
    "@/lib/outreach": {
      londonDate: () => today, clampOutreachDailyLimit: (value) => Number(value) || 1,
      outreachCrmGuard: async () => ({}), prospectHasBlockedCrmRelationship: () => false,
    },
    "@/lib/sendpilot-outreach": { loadSendPilotOutreachContext: async () => ({ mappings: [], links: [] }) },
    "@/lib/outreach-scoring": { scoreOutreachProspect: () => ({ action: "hold", score: 0 }) },
    "@/lib/outreach-team-safety": {
      outreachSafetyError: () => null, isActiveOutreachEnrolmentStatus: () => true,
      isInsideCrossCampaignCooldown: () => false,
    },
    "@/lib/outreach-sequence": { outreachSequenceStepAt: () => ({ channel: "email" }) },
    "@/lib/job-research-sources": {
      verifiedJobResearchEvidence: () => ({ jobSignals: [] }), verifiedCompanyResearchEvidence: () => ({}),
    },
  });
  const response = await route.POST({ json: async () => ({}) });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.queue.map((row) => row.id), expectedId ? [expectedId] : []);
  assert.equal(payload.selection.followUps, expectedId ? 1 : 0);
  for (const row of db.outreach_enrolments) {
    assert.equal(row.queued_for, row.id === expectedId ? today : null, "Foreign, future and other-campaign work must remain untouched");
  }
  assert.ok(requests.every(({ url }) => url.href.length < 8_000));
}

const prospectIds = Array.from({ length: 640 }, (_, index) => uuid(1_000 + index));
const links = prospectIds.map((prospectId, index) => ({
  id: uuid(4_000 + index), integration_id: `integration-${alice}`, workspace_id: workspace,
  owner_id: alice, outreach_prospect_id: prospectId,
  updated_at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
}));
links.push(
  { ...links[0], id: uuid(5_000), integration_id: `integration-${bob}`, owner_id: bob },
  { ...links[0], id: uuid(5_001), workspace_id: outside },
);
const db = { sendpilot_lead_links: links };
const { client, requests } = databaseClient(db);
const { loadSendPilotLeadLinksForOwner: loadLinks } = compile("lib/sendpilot-outreach.ts", {
  "@/lib/supabase": { supabaseService: client },
  "@/lib/sendpilot": { loadSendPilotIntegrationForOwner: async (scope) => ({ id: `integration-${scope.userId}` }) },
});
const scope = { userId: alice, workspaceId: workspace };
const loaded = await loadLinks(scope, [...prospectIds, prospectIds[0]]);
assert.equal(loaded.length, 640, "Every requested prospect must survive batching without duplicates");
assert.equal(loaded[0].id, uuid(4_639), "Keep newest-first order across batches");
assert.ok(loaded.every((row) => row.owner_id === alice && row.workspace_id === workspace));
assert.ok(requests.every(({ url }) => url.href.length < 8_000));
const bobLinks = await loadLinks({ userId: bob, workspaceId: workspace }, prospectIds);
assert.deepEqual(bobLinks.map((row) => row.id), [uuid(5_000)]);
const beforeEmpty = requests.length;
assert.deepEqual(await loadLinks(scope, []), []);
assert.equal(requests.length, beforeEmpty, "An explicit empty list must not load all owner links");
assert.equal((await loadLinks(scope)).length, 640, "Omitting the list retains the scoped recent-links view");
db.failProspect = prospectIds[150];
await assert.rejects(() => loadLinks(scope, prospectIds), (error) => error.message === "A batch failed");

console.log("Large outreach assignments passed. Queue limits, due ordering, 640 prospects, SendPilot batching, two users, workspace isolation, empty lists and batch failures verified.");
