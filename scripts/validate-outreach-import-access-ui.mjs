import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(file, replacements = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(
    (name) => name === "server-only" ? {} : name in replacements ? replacements[name] : require(name),
    module, module.exports
  );
  return module.exports;
}

const user = "00000000-0000-4000-8000-000000000001";
const teammate = "00000000-0000-4000-8000-000000000002";
const workspace = "00000000-0000-4000-8000-000000000003";
let scope = { userId: user, workspaceId: workspace, role: "sales", status: "active" };
let databaseActive = true;
const reads = [];
const service = {
  async rpc(name, args) {
    assert.equal(name, "can_stage_outreach_import_service");
    assert.deepEqual(args, { p_workspace_id: workspace, p_actor_user_id: user });
    return { data: databaseActive, error: null };
  },
  from(table) {
    const filters = [];
    const query = {
      select(columns) { reads.push({ table, columns, filters }); return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      order() { return query; },
      in(key, values) { filters.push([key, values]); return query; },
      then(resolve, reject) { return Promise.resolve({ data: table === "workspace_members" ? [{ user_id: user }, { user_id: teammate }] : [{ user_id: teammate, display_name: "Teammate" }], error: null }).then(resolve, reject); },
    };
    return query;
  },
};
const access = compile("lib/outreach-import-access.ts", {
  "@/lib/request-scope": { requireRequestScope: () => scope },
  "@/lib/supabase": { supabaseService: service },
});
const route = compile("app/api/crm/imports/outreach/access/route.ts", {
  "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
  "@/lib/outreach-import-access": access,
  "@/lib/supabase": { supabaseService: service },
});
for (const role of ["sales", "manager"]) {
  scope.role = role;
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { currentUser: user, canAssignImports: false, team: [] });
  assert.equal(reads.length, 0, "Staff upload checks must not read the team directory or lead data");
}
scope.role = "owner";
const ownerResponse = await route.GET();
const ownerAccess = await ownerResponse.json();
assert.equal(ownerAccess.canAssignImports, true);
assert.equal(ownerAccess.team.length, 2);
assert.deepEqual(reads[0].filters, [["workspace_id", workspace], ["status", "active"]]);
assert.equal(reads[1].columns, "user_id,display_name");
assert.deepEqual(reads[1].filters, [["user_id", [user, teammate]]]);
scope.role = "sales";
for (const status of ["onboarding", "suspended", "removed"]) {
  scope.status = status;
  assert.equal((await route.GET()).status, 403);
}
scope.status = "active";
databaseActive = false;
assert.equal((await route.GET()).status, 403, "Stale active request metadata must not bypass current database membership");

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://crm.invalid" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { Simulate } = require("react-dom/test-utils");
const { act } = React;
const calls = [];
let failAccess = false;
let stagedBatch;
const importer = compile("components/crm/StagedOutreachImports.tsx", {
  "@/lib/outreach-import": compile("lib/outreach-import.ts"),
  "@/lib/crm": { crmFetch: async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/crm/imports/outreach/access") {
      if (failAccess) throw new Error("Access check temporarily unavailable");
      return { currentUser: user, canAssignImports: false, team: [] };
    }
    if (url === "/api/crm/imports/outreach") return { batches: stagedBatch ? [stagedBatch] : [] };
    if (url === "/api/crm/imports/outreach/stage") {
      const body = JSON.parse(options.body);
      assert.equal(body.assignedToUserId, user);
      stagedBatch = { id: "test-batch", source_name: body.sourceName, status: "staged", assigned_to_user_id: user, ready_count: 1, row_count: 1, review_count: 0, duplicate_count: 0, invalid_count: 0, rows: [] };
      return { batch: stagedBatch };
    }
    if (url.endsWith("/apply")) {
      stagedBatch = { ...stagedBatch, status: "applied", applied_at: new Date().toISOString() };
      return { result: { inserted: 1, appliedAt: stagedBatch.applied_at } };
    }
    throw new Error(`Unexpected request ${url}`);
  } },
}).default;
const root = createRoot(document.getElementById("root"));
const button = (label) => [...document.querySelectorAll("button")].find((element) => element.textContent === label);
await act(async () => root.render(React.createElement(importer, { onApplied: async () => { throw new Error("Prospects list is temporarily unavailable"); } })));
assert.equal(button("Import CSV").disabled, false);
assert.ok(calls.every((call) => call.url !== "/api/crm/outreach"));
await act(async () => button("Import CSV").click());
assert.match(document.body.textContent, /These leads will be assigned to you/);
assert.equal(document.querySelector("select"), null, "Staff cannot choose someone else as assignee");
await act(async () => Simulate.change(document.querySelector("textarea"), { target: { value: "Email,First Name,Company\nnew@example.invalid,New,Example" } }));
assert.equal(button("Stage and check").disabled, false);
await act(async () => button("Stage and check").click());
assert.match(document.body.textContent, /invalid · You/);
await act(async () => button("Import 1 clean rows").click());
assert.match(document.body.textContent, /1 clean leads were imported.*Do not re-import/);
assert.equal(button("Import 1 clean rows"), undefined);

await act(async () => root.render(null));
failAccess = true;
await act(async () => root.render(React.createElement(importer, { onApplied: () => {} })));
assert.equal(button("Import CSV").disabled, true);
assert.match(document.querySelector('[role="alert"]').textContent, /Access check temporarily unavailable/);
failAccess = false;
await act(async () => button("Retry upload access").click());
assert.equal(button("Import CSV").disabled, false);
await act(async () => root.unmount());
dom.window.close();

const page = read("app/crm/outreach/page.tsx");
assert.match(page, /\{tab === "prospects" \? <StagedOutreachImports onApplied=\{async \(\) => \{ setProspectCampaignId\("all"\); await loadProspects\(\); \}\}/);
assert.doesNotMatch(page, /canStageImports|setCanStageImports/);
console.log("Import access and UI passed. Active membership, private capabilities, self-assignment, independent loading, saved receipts and retry verified.");
