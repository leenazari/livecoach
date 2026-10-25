import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server.js";

const require = createRequire(import.meta.url);
function compile(file, replacements = {}, extra = "") {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(file, "utf8") + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)(name => {
    if (name in replacements) return replacements[name];
    if (name === "server-only" || name.startsWith("@/")) return {};
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const id = n => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const alice = id(1), bob = id(2), workspace = id(3), otherWorkspace = id(4), prospectId = id(5), campaignId = id(6);
const scope = { userId: alice, workspaceId: workspace, role: "sales", status: "active" };
const today = "2026-10-27";
const person = { id: prospectId, workspace_id: workspace, assigned_to_user_id: alice, status: "new", first_name: "Example", last_name: "Prospect", email: "example@example.test" };
const member = { id: id(7), workspace_id: workspace, owner_id: bob, prospect_id: prospectId, campaign_id: campaignId, recipient_email: person.email,
  queued_for: "2026-10-26", status: "queued", current_step: 1, last_sent_at: null, next_action_at: null };
const campaign = { id: campaignId, workspace_id: workspace, owner_id: bob, name: "Existing campaign", status: "active", daily_limit: 50, sequence: [{ step: 1, channel: "email" }] };
let db, writes, reads, handoffs, assignmentCalls, failTable, beforePatch, relationshipBlocker;
function reset() {
  db = { outreach_prospects: [{ ...person }], outreach_enrolments: [{ ...member }], outreach_campaigns: [structuredClone(campaign)],
    outreach_suppressions: [], outreach_messages: [], outreach_events: [], outreach_learnings: [] };
  writes = []; reads = []; handoffs = 0; assignmentCalls = 0; failTable = undefined; beforePatch = undefined; relationshipBlocker = null;
}
reset();
const client = createClient("https://database.invalid", "test-only", { global: { fetch: async (input, init = {}) => {
  const url = new URL(String(input)), params = url.searchParams, table = url.pathname.split("/").pop(), method = init.method || "GET";
  if (table === failTable) return Response.json({ code: "READ_FAILED", message: "database unavailable" }, { status: 500 });
  if (method === "PATCH" && beforePatch) { const mutate = beforePatch; beforePatch = undefined; mutate(); }
  const matches = row => [...params].every(([key, value]) => {
    if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
    if (value.startsWith("neq.")) return String(row[key]) !== value.slice(4);
    if (value === "is.null") return row[key] == null;
    if (value.startsWith("ilike.")) return String(row[key] || "").toLowerCase() === value.slice(6).toLowerCase();
    if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
    return true;
  });
  let rows = (db[table] || []).filter(matches).slice(0, Number(params.get("limit") || 1000));
  if (["GET", "HEAD"].includes(method)) reads.push({ table, params });
  else if (method === "PATCH") {
    assert.equal(table, "outreach_enrolments", "Repair must not change assignments, campaigns, prospect status or messages");
    assert.equal(params.get("workspace_id"), `eq.${workspace}`);
    assert.equal(params.get("prospect_id"), `eq.${prospectId}`);
    const patch = JSON.parse(init.body);
    assert.equal(patch.queued_for, today);
    assert.ok(Object.keys(patch).every(key => ["queued_for", "status", "next_action_at", "updated_at"].includes(key)));
    rows.forEach(row => Object.assign(row, patch));
    if (rows.length) writes.push({ table, method, patch });
  } else if (method === "POST") {
    assert.equal(table, "outreach_events", "Repair must only append its activity receipt");
    const body = JSON.parse(init.body);
    assert.equal(body.metadata.source, "brain_simple_error_repair");
    db[table].push(body); writes.push({ table, method, body }); rows = [body];
  } else assert.fail(`Unexpected ${method} ${table}`);
  const count = rows.length;
  const fields = params.get("select");
  if (fields && fields !== "*") rows = rows.map(row => Object.fromEntries(fields.split(",").map(key => [key, row[key]])));
  return new Response(method === "HEAD" ? null : JSON.stringify(rows), {
    status: 200, headers: { "Content-Type": "application/json", "Content-Range": `0-${Math.max(0, count - 1)}/${count}` },
  });
} } });
const blockers = compile("lib/crm-blocker.ts");
const preparation = compile("lib/outreach-preparation.ts", { "@/lib/crm-blocker": blockers });
const repair = compile("lib/outreach-queue-repair.ts");
const queuePolicy = compile("lib/outreach-queue-policy.ts");
const safety = compile("lib/outreach-team-safety.ts");
const common = {
  "@/lib/supabase": { supabaseAdmin: client },
  "@/lib/request-scope": { getRequestScope: () => scope },
  "@/lib/outreach": { londonDate: () => today, clampOutreachDailyLimit: value => Number(value || 50), outreachCrmGuard: async () => ({}) },
  "@/lib/outreach-preparation": preparation,
  "@/lib/outreach-queue-repair": repair,
  "@/lib/crm-blocker": blockers,
};
const queue = compile("app/api/crm/outreach/queue/route.ts", {
  ...common,
  "@/lib/record-scope": { resolveRecordScope: async () => scope },
  "@/lib/outreach-campaign-selection": { resolveOutreachCampaignSelection: async () => ({ campaigns: db.outreach_campaigns, campaign: db.outreach_campaigns[0] }) },
  "@/lib/outreach-team-safety": safety,
  "@/lib/outreach-queue-policy": queuePolicy,
  "@/lib/outreach-crm-blocker": { outreachCrmBlocker: () => relationshipBlocker },
  "@/lib/outreach-assignment-service": { assignOutreachProspectsWithCompanyAccess: async () => { assignmentCalls++; assert.fail("A simple repair must not claim or reassign a prospect"); } },
  "@/lib/sendpilot-outreach": { loadSendPilotOutreachContext: async () => ({ mappings: [], links: [] }) },
  "@/lib/outreach-scoring": { scoreOutreachProspect: () => ({}) },
  "@/lib/outreach-sequence": { outreachSequenceStepAt: () => ({ channel: "email" }) },
  "@/lib/job-research-sources": { verifiedJobResearchEvidence: () => ({}), verifiedCompanyResearchEvidence: () => ({}) },
});
process.env.BRAIN_ACTION_SIGNING_SECRET = "synthetic-test-signing-key-never-a-live-credential";
const authority = compile("lib/brain-authority.ts");
const assistant = compile("app/api/crm/assistant/route.ts", {
  ...common, "@/lib/brain-authority": authority,
}, "\nexport { resolveActions, authoriseResolvedActions };\n");
const prepare = compile("app/api/crm/outreach/[id]/prepare/route.ts", {
  ...common, "@/app/api/crm/outreach/queue/route": queue,
  "@/lib/outreach-identity": { resolveOutreachIdentity: async () => scope },
  "@/lib/workspace-profile": { ensureWorkspaceProfileId: async () => { handoffs++; throw Error("EXISTING_GENERATION_BOUNDARY"); } },
});
const requested = [{ type: "prepare_outreach", prospect: "Example Prospect", guidance: "Use saved facts" }];
const plan = await repair.loadOutreachQueueRepair({ client, scope, prospectId, today });
assert.ok(plan);
const post = async (body = { queueRepair: plan }) => {
  const originalError = console.error;
  try {
    console.error = () => {};
    const response = await prepare.POST(new NextRequest(`https://crm.test/api/crm/outreach/${prospectId}/prepare`, {
      method: "POST", body: JSON.stringify(body),
    }), { params: { id: prospectId } });
    return { status: response.status, data: await response.json() };
  } finally { console.error = originalError; }
};
let actions = await assistant.resolveActions(requested);
assert.equal(actions.length, 1);
assert.match(actions[0].label, /Fix .*missing queue entry.*Existing campaign/);
assert.equal(actions[0].body.guidance, "Use saved facts");
assert.deepEqual(actions[0].body.queueRepair, plan);
assert.equal(writes.length, 0, "A proposal cannot change the queue");
const signed = assistant.authoriseResolvedActions(actions, scope, false)[0];
assert.equal(signed.batchSafe, false);
assert.equal(signed.authority.requiresSeparateApproval, true);
assert.equal(signed.authority.risk, "paid_generation");
assert.deepEqual(authority.verifyBrainActionToken(signed.executionToken, scope).action.body.queueRepair, plan);
assert.throws(() => authority.verifyBrainActionToken(signed.executionToken, { ...scope, userId: bob }));

let result = await post();
assert.equal(result.status, 500, "Generation is deliberately stopped at its existing boundary");
assert.match(result.data.error, /queue entry was fixed.*EXISTING_GENERATION_BOUNDARY/);
assert.deepEqual(result.data.queueRepair, plan);
assert.equal(handoffs, 1);
assert.equal(db.outreach_enrolments[0].queued_for, today);
assert.equal(db.outreach_enrolments[0].owner_id, bob, "Shared membership ownership is preserved");
assert.equal(writes.length, 2);
assert.equal(assignmentCalls, 0);
writes = []; handoffs = 0;
result = await post();
assert.equal(handoffs, 1);
assert.equal(writes.length, 0, "Retry after a completed queue repair must not queue twice");

const unavailable = [
  () => { db.outreach_enrolments = []; },
  () => { db.outreach_enrolments.push({ ...member, id: id(8), campaign_id: id(9) }); },
  () => { db.outreach_enrolments[0].status = "paused"; },
  () => { db.outreach_enrolments[0].status = "approved"; },
  () => { db.outreach_enrolments[0].last_sent_at = "2026-10-20"; },
  () => { db.outreach_enrolments[0].current_step = 2; },
  () => { db.outreach_enrolments[0].queued_for = "2026-10-28"; },
  () => { db.outreach_enrolments[0].next_action_at = "2026-10-29"; },
  () => { db.outreach_campaigns[0].status = "paused"; },
  () => { db.outreach_campaigns[0].sequence = [{ step: 1, channel: "linkedin" }]; },
  () => { db.outreach_prospects[0].assigned_to_user_id = bob; },
  () => { db.outreach_prospects[0].assigned_to_user_id = null; },
  () => { db.outreach_prospects[0].workspace_id = otherWorkspace; },
  () => { db.outreach_enrolments[0].workspace_id = otherWorkspace; },
  () => { db.outreach_campaigns[0].workspace_id = otherWorkspace; },
];
for (const change of unavailable) {
  reset(); change();
  assert.equal(await repair.loadOutreachQueueRepair({ client, scope, prospectId, today }), null);
  result = await post();
  assert.equal(result.status, 409);
  assert.equal(result.data.blocker.code, "outreach_repair_changed");
  assert.equal(writes.length, 0); assert.equal(handoffs, 0);
}
for (const field of ["date", "campaignId", "enrolmentId", "prospectId"]) {
  reset(); result = await post({ queueRepair: { ...plan, [field]: "changed" } });
  assert.equal(result.status, 409); assert.equal(writes.length, 0); assert.equal(handoffs, 0);
}
reset(); result = await post({});
assert.equal(result.status, 400); assert.equal(writes.length, 0); assert.equal(handoffs, 0);
reset(); db.outreach_suppressions = [{ workspace_id: workspace, target: person.email }];
result = await post();
assert.equal(result.status, 400); assert.match(result.data.error, /do-not-contact/);
assert.equal(writes.length, 0); assert.equal(handoffs, 0);
reset(); relationshipBlocker = { status: 409, ...blockers.crmBlockerPayload({ code: "existing_relationship", title: "Protected", reason: "Existing customer", nextAction: "Ask manager" }) };
result = await post();
assert.equal(result.status, 409); assert.equal(result.data.blocker.code, "existing_relationship");
assert.equal(writes.length, 0); assert.equal(handoffs, 0);
for (const status of ["queued", "completed"]) {
  reset();
  db.outreach_enrolments.push({ ...member, id: id(12), prospect_id: id(13), campaign_id: id(14), status,
    last_sent_at: status === "completed" ? new Date().toISOString() : null });
  result = await post();
  assert.equal(result.status, 409);
  assert.match(result.data.error, status === "queued" ? /already active in another campaign/ : /last 30 days/);
  assert.equal(writes.length, 0); assert.equal(handoffs, 0);
  scope.role = "owner";
  try {
    const response = await queue.POST(new NextRequest("https://crm.test/api/crm/outreach/queue", {
      method: "POST", body: JSON.stringify({ prospectId, campaignId, preparationRepair: plan,
        cooldownOverrideReason: "A repair may never override contact restrictions" }),
    }));
    assert.equal(response.status, 409, "Even an owner cannot turn a simple repair into a cooldown override");
    assert.equal(writes.length, 0);
  } finally { scope.role = "sales"; }
}
reset(); failTable = "outreach_suppressions";
result = await post();
assert.equal(result.status, 500); assert.equal(writes.length, 0); assert.equal(handoffs, 0);
reset(); db.outreach_campaigns[0].daily_limit = 1;
db.outreach_prospects.push({ ...person, id: id(10) });
db.outreach_enrolments.push({ ...member, id: id(11), prospect_id: id(10), queued_for: today });
result = await post();
assert.equal(result.status, 400); assert.match(result.data.error, /queue already has/);
assert.equal(writes.length, 0); assert.equal(handoffs, 0);
reset(); beforePatch = () => { db.outreach_enrolments[0].last_sent_at = "2026-10-27"; };
result = await post();
assert.equal(result.status, 409); assert.equal(writes.length, 0); assert.equal(handoffs, 0);
reset(); failTable = "outreach_events";
result = await post();
assert.equal(result.status, 502); assert.match(result.data.error, /queue entry was fixed.*receipt/);
assert.equal(handoffs, 0); assert.equal(writes.length, 1);
reset(); failTable = "outreach_enrolments";
await assert.rejects(() => repair.loadOutreachQueueRepair({ client, scope, prospectId, today }), error => error.code === "READ_FAILED");
assert.equal(writes.length, 0);
console.log("Brain simple-error repair passed: real proposal, signed approval, preparation and queue handlers; one exact existing membership repaired and rechecked, no assignment or campaign edits, stale/racing requests and safety restrictions blocked, partial outcomes reported. All data and model calls simulated.");
