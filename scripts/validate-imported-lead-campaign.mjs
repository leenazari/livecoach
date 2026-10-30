import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function compile(file, replacements = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename: file })(
    (name) => name === "server-only" ? {} : name in replacements ? replacements[name] : require(name),
    module, module.exports
  );
  return module.exports;
}
const uuid = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const alice = uuid(1), bob = uuid(2), workspace = uuid(3), elsewhere = uuid(4);
const campaignId = uuid(5), secondCampaign = uuid(6), prospectId = uuid(7);
const today = "2026-10-30";
const safety = compile("lib/outreach-team-safety.ts");
const choice = compile("lib/outreach-prospect-campaign.ts").prospectCampaignChoice;
const campaigns = [
  { id: campaignId, name: "Workable", status: "active", daily_limit: 50 },
  { id: secondCampaign, name: "Recruitment", status: "active", daily_limit: 50 },
  { id: uuid(8), name: "Inactive", status: "paused", daily_limit: 50 },
];

// The UI may propose a campaign but call logging must use actual membership.
assert.deepEqual(choice({}, campaigns, campaignId), { campaign: campaigns[0], needsCampaign: true, callCampaignId: null });
assert.equal(choice({}, campaigns, secondCampaign).campaign.id, secondCampaign);
assert.equal(choice({}, campaigns, uuid(8)).campaign, null);
assert.equal(choice({}, campaigns, uuid(99)).campaign, null);
const existingLead = { outreach: { campaignIds: [secondCampaign], enrolment: { campaign_id: secondCampaign } } };
assert.deepEqual(choice(existingLead, campaigns, campaignId), { campaign: campaigns[1], needsCampaign: false, callCampaignId: secondCampaign });
assert.equal(choice({ outreach: { campaignIds: [uuid(8)] } }, campaigns, campaignId).campaign, null);
assert.equal(choice({ outreach: { enrolment: { campaign_id: secondCampaign } } }, campaigns, campaignId).needsCampaign, false);

function fixture() {
  return {
    outreach_prospects: [
      { id: prospectId, workspace_id: workspace, owner_id: alice, assigned_to_user_id: alice, email: "fresh@example.invalid", company_name: "Fresh lead", source_file: "V5.csv", status: "imported" },
      { id: uuid(10), workspace_id: workspace, assigned_to_user_id: bob, email: "other@example.invalid", status: "imported" },
      { id: uuid(11), workspace_id: elsewhere, assigned_to_user_id: alice, email: "foreign@example.invalid", status: "imported" },
      { id: uuid(12), workspace_id: workspace, assigned_to_user_id: bob, email: "existing@example.invalid", status: "imported" },
    ],
    outreach_campaigns: structuredClone(campaigns),
    // Regression fixture matches a populated shared campaign, not an empty one.
    outreach_enrolments: [{ id: uuid(20), workspace_id: workspace, campaign_id: campaignId, prospect_id: uuid(12), recipient_email: "existing@example.invalid", status: "paused", current_step: 1, queued_for: null }],
    outreach_messages: [], outreach_events: [], outreach_learnings: [], outreach_suppressions: [],
  };
}

function harness(db = fixture(), userId = alice) {
  const scope = { userId, workspaceId: workspace, role: "sales", status: "active" };
  const requests = [];
  let serial = 100;
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    const method = init.method || "GET";
    requests.push({ table, method, url });
    if (scope.status !== "active") return Response.json({ message: "permission denied" }, { status: 403 });
    const isRead = method === "GET";
    if (db.failRead === table && isRead) return Response.json({ message: "private database diagnostic" }, { status: 500 });
    if (db.failWrite === table && !isRead) return Response.json({ message: "private database diagnostic" }, { status: 500 });
    if (db.interruptRead === table && isRead) throw new Error("fetch failed");
    const rows = (db[table] || []).filter((row) => {
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        if (value.startsWith("eq.") && String(row[key]) !== value.slice(3)) return false;
        if (value.startsWith("neq.") && String(row[key]) === value.slice(4)) return false;
        if (value.startsWith("in.(") && !value.slice(4, -1).split(",").includes(String(row[key]))) return false;
        if (value === "is.null" && row[key] != null) return false;
      }
      return true;
    });
    let output = rows;
    if (method === "POST") {
      assert.ok(["outreach_enrolments", "outreach_events"].includes(table), "Preparing must not create messages or duplicate prospects");
      const value = { id: uuid(serial++), workspace_id: workspace, owner_id: userId, ...JSON.parse(init.body) };
      if (table === "outreach_enrolments") {
        if (db.enrolmentConflict) return Response.json({ message: "outreach_one_active_campaign_per_recipient_email" }, { status: 409 });
        value.recipient_email = db.outreach_prospects.find((row) => row.id === value.prospect_id)?.email;
        assert.equal(db.outreach_enrolments.filter((row) => row.prospect_id === value.prospect_id && row.campaign_id === value.campaign_id).length, 0, "No duplicate memberships");
      }
      db[table].push(value);
      output = [value];
    } else if (method === "PATCH") {
      assert.ok(["outreach_enrolments", "outreach_prospects"].includes(table));
      output = db.missingProspectUpdate && table === "outreach_prospects" ? [] : rows;
      output.forEach((row) => Object.assign(row, JSON.parse(init.body)));
    } else assert.equal(method, "GET");
    const headers = new Headers(init.headers);
    if (headers.get("accept")?.includes("vnd.pgrst.object")) {
      return output.length === 1 ? Response.json(output[0]) : Response.json({ code: "PGRST116", message: "Expected one row", details: `The result contains ${output.length} rows` }, { status: 406 });
    }
    return Response.json(structuredClone(output));
  };
  const client = createClient("https://database.invalid", "test-key", { global: { fetch } });
  const route = compile("app/api/crm/outreach/queue/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase": { supabaseAdmin: client },
    "@/lib/record-scope": { resolveRecordScope: async () => scope },
    "@/lib/request-scope": { getRequestScope: () => scope },
    "@/lib/uuid": compile("lib/uuid.ts"),
    "@/lib/crm-blocker": compile("lib/crm-blocker.ts"),
    "@/lib/outreach-campaign-selection": { resolveOutreachCampaignSelection: async () => ({ campaign: db.outreach_campaigns[0], campaigns: db.outreach_campaigns }) },
    "@/lib/outreach-identity": { resolveOutreachIdentity: async () => ({ userId }) },
    "@/lib/outreach": { londonDate: () => today, clampOutreachDailyLimit: (n) => Number(n) || 50, outreachCrmGuard: async () => ({}), prospectHasBlockedCrmRelationship: () => false },
    "@/lib/outreach-scoring": { scoreOutreachProspect: () => ({ action: "contact_today", score: 80 }) },
    "@/lib/outreach-team-safety": safety,
    "@/lib/outreach-sequence": { outreachSequenceStepAt: () => ({ channel: "email" }) },
    "@/lib/outreach-queue-policy": compile("lib/outreach-queue-policy.ts"),
    "@/lib/outreach-queue-repair": {},
    "@/lib/sendpilot-outreach": { loadSendPilotOutreachContext: async () => ({ mappings: [], links: [] }) },
    "@/lib/outreach-assignment-service": {
      assignOutreachProspectsWithCompanyAccess: async ({ actorUserId, workspaceId, prospectIds, assignedToUserId }) => {
        assert.equal(actorUserId, userId); assert.equal(assignedToUserId, userId); assert.equal(workspaceId, workspace);
        if (db.claimConflict) throw new Error("Another teammate claimed this prospect first");
        assert.equal(scope.status, "active");
        prospectIds.forEach((id) => { const row = db.outreach_prospects.find((item) => item.id === id && item.workspace_id === workspace); assert.ok(row); assert.ok(!row.assigned_to_user_id || row.assigned_to_user_id === userId); row.assigned_to_user_id = userId; });
      },
      outreachAssignmentConflict: (error) => error.message.includes("Another teammate") ? error.message : null,
    },
    "@/lib/outreach-crm-blocker": { outreachCrmBlocker: () => db.protectedClient ? { status: 409, error: "Protected client cannot enter outreach" } : null },
    "@/lib/job-research-sources": { verifiedJobResearchEvidence: () => ({ jobSignals: [] }), verifiedCompanyResearchEvidence: () => ({}) },
  });
  return { db, scope, requests, route, post: async (body = {}) => {
    const response = await route.POST({ json: async () => ({ prospectId, campaignId, addToCampaign: true, ...body }) });
    return { status: response.status, payload: await response.json() };
  } };
}

for (const actor of [alice, bob]) {
  const db = fixture();
  db.outreach_prospects[0].assigned_to_user_id = actor;
  const h = harness(db, actor);
  assert.equal((await h.post()).status, 200, "An explicitly chosen imported lead can join a populated campaign");
  const saved = db.outreach_enrolments.find((row) => row.prospect_id === prospectId);
  assert.equal(saved.campaign_id, campaignId); assert.equal(saved.owner_id, actor);
  assert.equal(db.outreach_prospects[0].status, "queued");
  assert.equal(db.outreach_events[0].metadata.campaignJoined, true);
  assert.equal(db.outreach_messages.length, 0);
  // An interrupted first response must be recoverable without duplicate leads,
  // duplicate enrolments or a full-queue blocker on the same reserved slot.
  db.outreach_campaigns[0].daily_limit = 1;
  assert.equal((await h.post()).status, 200);
  assert.equal(db.outreach_enrolments.filter((row) => row.prospect_id === prospectId).length, 1);
  const refreshed = await h.route.GET();
  assert.equal((await refreshed.json()).queue[0].campaign_id, campaignId);
}

for (const body of [{ addToCampaign: false }, { addToCampaign: "true" }, { campaignId: "" }]) {
  const h = harness(); const result = await h.post(body);
  assert.equal(result.status, 409); assert.equal(result.payload.blocker.code, "outreach_campaign_choice_required");
  assert.ok(h.requests.every((request) => request.method === "GET"));
}
for (const [body, status] of [[{ prospectId: "invalid" }, 400], [{ prospectId: uuid(10) }, 403], [{ prospectId: uuid(11) }, 404], [{ campaignId: uuid(8) }, 400], [{ campaignId: uuid(99) }, 400]]) {
  const h = harness(); assert.equal((await h.post(body)).status, status);
  assert.ok(h.requests.every((request) => request.method === "GET"));
}
for (const status of ["paused", "contacted", "completed"]) {
  const h = harness();
  h.db.outreach_enrolments.push({ id: uuid(21), workspace_id: workspace, prospect_id: prospectId, campaign_id: secondCampaign, status, recipient_email: null });
  const result = await h.post();
  assert.equal(result.status, 409); assert.equal(result.payload.blocker.code, "outreach_existing_campaign");
  assert.equal(h.db.outreach_enrolments.length, 2, "Do not move even historical membership or rely on a populated email column");
}
for (const field of ["failRead", "interruptRead"]) {
  const h = harness(); h.db[field] = "outreach_enrolments";
  const result = await h.post(); assert.equal(result.status, 500);
  assert.doesNotMatch(result.payload.error, /private database diagnostic/);
  assert.match(result.payload.error, /could not be verified|could not be confirmed/i);
  assert.ok(h.requests.every((request) => request.method === "GET"));
}
for (const flag of ["protectedClient", "claimConflict", "enrolmentConflict"]) {
  const h = harness(); h.db[flag] = true;
  assert.equal((await h.post()).status, 409); assert.equal(h.db.outreach_enrolments.length, 1);
}
for (const status of ["suppressed", "not_interested", "replied", "qualified"]) {
  const h = harness(); h.db.outreach_prospects[0].status = status;
  assert.equal((await h.post()).status, 400);
}
for (const target of ["fresh@example.invalid", "example.invalid"]) {
  const h = harness(); h.db.outreach_suppressions.push({ workspace_id: workspace, target });
  assert.equal((await h.post()).status, 400);
}
for (const other of [{ status: "paused", last_sent_at: null }, { status: "completed", last_sent_at: new Date().toISOString() }]) {
  const h = harness(); h.db.outreach_enrolments.push({ id: uuid(22), workspace_id: workspace, prospect_id: uuid(50), campaign_id: secondCampaign, recipient_email: "fresh@example.invalid", ...other });
  assert.equal((await h.post()).status, 409, "Retain exact-email cross-campaign locks and cooldowns");
  assert.equal(h.db.outreach_enrolments.length, 2);
}
for (const failure of ["outreach_events", "outreach_prospects", "missing-row"]) {
  const h = harness();
  if (failure === "missing-row") h.db.missingProspectUpdate = true; else h.db.failWrite = failure;
  const result = await h.post();
  assert.equal(result.status, 500); assert.equal(result.payload.blocker.code, "outreach_queue_partial_save");
  assert.match(result.payload.error, /campaign and queue entry were saved/);
  assert.doesNotMatch(result.payload.error, /private database diagnostic/);
  assert.equal(h.db.outreach_enrolments.length, 2); assert.equal(h.db.outreach_messages.length, 0);
}
for (const status of ["suspended", "removed"]) {
  const h = harness(); h.scope.status = status;
  assert.notEqual((await h.post()).status, 200); assert.equal(h.db.outreach_enrolments.length, 1);
}

const page = read("app/crm/outreach/page.tsx");
assert.match(page, /addToCampaign: choice\.needsCampaign/);
assert.match(page, /campaignId=\{campaignChoice\.callCampaignId\}/);
assert.match(page, /Not in a campaign yet/);
assert.match(page, /campaignChoice.needsCampaign \? "Add and prepare"/);
assert.match(page, /setProspectCampaignId\("all"\); await loadProspects/);
assert.match(read("components/crm/StagedOutreachImports.tsx"), /no campaign selected yet/);
// Ranked/automatic preparation remains within the existing campaign audience.
assert.match(read("app/api/crm/outreach/queue/route.ts"), /campaignProspectIds\.has\(prospect\.id\)/);
console.log("Imported lead campaign regression passed. Two accounts, explicit choice, refresh/retry, existing membership, private/protected boundaries, email safety, partial saves and manual call context verified.");
