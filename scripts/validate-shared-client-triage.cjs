const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const scope = { userId: "343cc366-d105-402e-a338-b32132d8c637", workspaceId: "9961b7c1-413d-4c96-9bbd-64466ff9fe25", role: "sales" };
const clientId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const source = ts.transpileModule(fs.readFileSync("app/api/crm/triage/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const policySource = ts.transpileModule(fs.readFileSync("lib/client-sharing-policy.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const policy = { exports: {} };
vm.runInNewContext(policySource, { exports: policy.exports, module: policy });
async function scenario(options = {}) {
  const company = { id: clientId, name: "Shared sales client", workspace_id: scope.workspaceId, owner_id: otherId, is_confidential: false, stage: "New", profile: { privateSource: "must stay private" }, updated_at: "2026-10-19T08:00:00Z", ...options.company };
  const tables = { companies: [company], team_client_shares: options.shares || [], opportunities: options.deals || [], tasks: [
    { id: "mine", company_id: clientId, workspace_id: scope.workspaceId, owner_id: scope.userId, status: "open" },
    { id: "theirs", company_id: clientId, workspace_id: scope.workspaceId, owner_id: otherId, status: "open" },
  ] };
  const writes = [], reads = [], tasks = [];
  function client(service) { return { from(table) {
    let patch, filters = [], selected;
    const query = {
      select(columns) { selected = columns; return query; },
      update(value) { patch = value; return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      is(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (options.race && table === "companies" && patch) company.updated_at = "changed";
          const rows = tables[table].filter(row => (service || table !== "companies" || row.owner_id === scope.userId) && filters.every(test => test(row)));
          if (patch) { writes.push({ table, count: rows.length }); for (const row of rows) Object.assign(row, patch); }
          else reads.push({ table, service });
          return { data: rows.map(row => selected === "id" ? { id: row.id } : row), error: null };
        }).then(resolve, reject);
      }
    };
    return query;
  } }; }
  const imports = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/supabase": { supabaseAdmin: client(false), supabaseService: client(true) },
    "@/lib/tasks": { upsertTasks: async (...args) => tasks.push(args) },
    "@/lib/request-scope": { requireRequestScope: () => scope },
    "@/lib/team-lead-cover": { loadTeamLeadCoverCompanies: async () => options.cover === false ? [] : [{ id: clientId }] },
    "@/lib/team-client-sharing": { loadSafeSharedCompanies: async ids => ids.includes(clientId) ? [{ id: clientId }] : [] },
    "@/lib/client-sharing-policy": policy.exports,
    "@/lib/crm-blocker": { crmBlockerPayload: blocker => ({ error: blocker.reason, blocker }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, module, require: name => { assert.ok(imports[name], name); return imports[name]; }, Date, Set, Map });
  const response = await module.exports.POST({ json: async () => ({ items: options.items || [{ id: clientId, classification: options.classification || "prospect", nextAction: "Call client" }] }) });
  return { ...response, writes, reads, company, tasks, tables };
}
(async () => {
  let result = await scenario();
  assert.equal(result.status, 200, "Team cover must save clients hidden by raw company RLS");
  assert.equal(result.company.profile.privateSource, "must stay private");
  assert.equal(result.company.profile.triage.classification, "prospect");
  assert.equal(result.tasks.length, 1);
  assert.ok(!JSON.stringify(result.body).includes("must stay private"));
  result = await scenario({ cover: false });
  assert.equal(result.status, 404);
  assert.equal(result.writes.length, 0);
  assert.ok(!result.reads.some(read => read.service), "No privileged snapshot before access is established");
  result = await scenario({ cover: false, shares: [{ company_id: clientId, workspace_id: scope.workspaceId, assigned_to_user_id: scope.userId, status: "active" }] });
  assert.equal(result.status, 200, "Assigned shared clients can be reviewed without team cover");
  result = await scenario({ cover: false, shares: [{ company_id: clientId, workspace_id: scope.workspaceId, assigned_to_user_id: otherId, status: "active" }] });
  assert.equal(result.status, 404, "View-only share must not grant editing");
  for (const company of [{ is_confidential: true }, { stage: "Investor" }, { profile: { internal: true } }, { workspace_id: "another-workspace" }]) {
    result = await scenario({ company });
    assert.ok([403, 409].includes(result.status));
    assert.equal(result.writes.length, 0);
  }
  result = await scenario({ classification: "in_house" });
  assert.equal(result.status, 403);
  assert.equal(result.writes.length, 0);
  result = await scenario({ classification: "irrelevant", deals: [{ company_id: clientId, workspace_id: scope.workspaceId, status: "open", opportunity_type: "revenue" }] });
  assert.equal(result.status, 409, "Hidden revenue opportunities must still prevent archive");
  assert.equal(result.writes.length, 0);
  result = await scenario({ classification: "irrelevant" });
  assert.equal(result.status, 200);
  assert.equal(result.tables.tasks[0].status, "dismissed");
  assert.equal(result.tables.tasks[1].status, "open", "Another salesperson's reminders remain private and untouched");
  result = await scenario({ cover: false, company: { owner_id: scope.userId }, classification: "in_house" });
  assert.equal(result.status, 200, "Owners retain private classification access");
  result = await scenario({ race: true });
  assert.equal(result.status, 409);
  assert.equal(result.writes[0].count, 0);
  assert.equal(result.tasks.length, 0);
  result = await scenario({ items: [{ id: clientId, classification: "prospect" }, { id: otherId, classification: "prospect" }] });
  assert.equal(result.status, 404);
  assert.equal(result.writes.length, 0, "Validate the whole batch before any writes");
  console.log("Shared client triage: access, privacy, assignment, archive and stale-record checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
