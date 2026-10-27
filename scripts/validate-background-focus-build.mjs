import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import * as focusBuild from "../lib/call-focus-build.ts";
import * as leadContext from "../lib/call-lead-context.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function compile(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      console,
      Date,
      Error,
      require(name) {
        if (name === "server-only") return {};
        if (name in dependencies) return dependencies[name];
        throw new Error(`Missing dependency ${name}`);
      },
    }
  );
  return exports;
}

assert.deepEqual(
  focusBuild.mergeFocusBuild({
    mode: "focus",
    selectedFocus: ["Stale focus from another call"],
    result: { focusAreas: ["Confirm pilot users", "Agree launch date"] },
  }),
  {
    suggestedFocus: ["Confirm pilot users", "Agree launch date"],
    selectedFocus: ["Confirm pilot users", "Agree launch date"],
    added: 0,
    upgraded: 0,
  }
);

const reconciled = focusBuild.mergeFocusBuild({
  mode: "refocus",
  existingFocus: ["Confirm pilot users", "Agree launch date"],
  selectedFocus: ["Confirm pilot users"],
  result: {
    reconcile: true,
    additions: [
      "Confirm pilot user list",
      "Set support ownership",
    ],
    upgrades: [
      { from: "Agree launch date", to: "Agree 12 November launch date" },
    ],
  },
});
assert.deepEqual(reconciled.suggestedFocus, [
  "Confirm pilot users",
  "Agree 12 November launch date",
  "Set support ownership",
]);
assert.deepEqual(reconciled.selectedFocus, [
  "Confirm pilot users",
  "Set support ownership",
]);
assert.equal(reconciled.added, 1);
assert.equal(reconciled.upgraded, 1);

const planRoute = read("app/api/interview/plan/route.ts");
const callPage = read("app/call/page.tsx");
assert.match(planRoute, /waitUntil\([\s\S]*focusTask/);
assert.match(planRoute, /verifyFocusBuildTarget\(scope, upcomingId\)/);
assert.match(planRoute, /persistFocusBuild\(\{/);
assert.match(planRoute, /FocusPersistenceError/);
assert.match(callPage, /upcomingId: upcomingIdRef\.current \|\| null/);
assert.match(callPage, /new TextEncoder\(\)\.encode\(planBody\)\.byteLength <= 60 \* 1024/);
assert.match(callPage, /keepalive: keepFocusAlive/);
assert.match(callPage, /persistedFocus/);

function makeDb({
  owner = "owner-a",
  workspace = "workspace-a",
  leadVersion = "lead-v1",
  race = false,
} = {}) {
  const row = {
    id: "call-1",
    owner_id: owner,
    workspace_id: workspace,
    company_id: "company-1",
    intent: "Agree the pilot shape",
    prepped: false,
    prep: {
      leadSelection: { email: "buyer@example.com", savedAt: leadVersion },
      intentMeta: { source: "generated", savedAt: "intent-v1" },
      privateNotes: ["Keep the budget limit private"],
    },
  };
  let writes = 0;
  return {
    row,
    get writes() {
      return writes;
    },
    client: {
      from(table) {
        assert.equal(table, "upcoming_calls");
        let patch = null;
        const filters = [];
        return {
          select() {
            return this;
          },
          update(value) {
            patch = value;
            if (race) row.prep = { ...row.prep, privateNotes: ["Newer edit"] };
            return this;
          },
          eq(key, value) {
            filters.push([key, value]);
            return this;
          },
          is(key, value) {
            filters.push([key, value]);
            return this;
          },
          async maybeSingle() {
            const matches = filters.every(([key, value]) => {
              const actual = row[key];
              return typeof actual === "object" && actual !== null
                ? JSON.stringify(actual) === value
                : actual === value;
            });
            if (!matches) return { data: null, error: null };
            if (patch) {
              Object.assign(row, structuredClone(patch));
              writes += 1;
            }
            return { data: structuredClone(row), error: null };
          },
        };
      },
    },
  };
}

async function persistenceModule(db) {
  return compile("lib/call-focus-persistence.ts", {
    "@/lib/call-focus-build": focusBuild,
    "@/lib/call-lead-context": leadContext,
    "@/lib/record-scope": {},
    "@/lib/supabase": { supabaseAdmin: db.client },
  });
}

const db = makeDb();
const persistence = await persistenceModule(db);
const scope = { userId: "owner-a", workspaceId: "workspace-a" };
assert.equal(
  (await persistence.verifyFocusBuildTarget(scope, "call-1")).company_id,
  "company-1"
);
const saved = await persistence.persistFocusBuild({
  scope,
  upcomingId: "call-1",
  mode: "focus",
  brief: "Agree the pilot shape",
  role: "Partnership call",
  subjectName: "Alex",
  emailContext: "Alex wants a ten-person pilot",
  leadSelectionVersion: "lead-v1",
  intentVersion: "intent-v1",
  result: {
    callType: "sales",
    subjectName: "Alex",
    character: "A practical buyer who wants a contained pilot.",
    focusAreas: ["Confirm ten pilot users", "Agree success measures"],
  },
});
assert.equal(db.writes, 1);
assert.equal(db.row.prepped, true);
assert.deepEqual(Array.from(saved.saved.prep.suggestedComps), [
  "Confirm ten pilot users",
  "Agree success measures",
]);
assert.deepEqual(Array.from(saved.saved.prep.privateNotes), [
  "Keep the budget limit private",
]);

for (const scenario of ["other-owner", "other-workspace", "lead-change", "race"]) {
  const isolated = makeDb({
    leadVersion: scenario === "lead-change" ? "lead-v2" : "lead-v1",
    race: scenario === "race",
  });
  const module = await persistenceModule(isolated);
  const badScope = {
    userId: scenario === "other-owner" ? "owner-b" : "owner-a",
    workspaceId:
      scenario === "other-workspace" ? "workspace-b" : "workspace-a",
  };
  await assert.rejects(
    module.persistFocusBuild({
      scope: badScope,
      upcomingId: "call-1",
      mode: "focus",
      brief: "Agree the pilot shape",
      role: "Partnership call",
      leadSelectionVersion: "lead-v1",
      intentVersion: "intent-v1",
      result: { focusAreas: ["Confirm pilot users"] },
    }),
    (error) =>
      [
        "focus_call_not_found",
        "focus_lead_changed",
        "focus_save_conflict",
      ].includes(error.code)
  );
  assert.equal(isolated.writes, 0);
}

console.log(
  "Background focus continuation, exact saved result, concurrency and two-user isolation checks passed"
);
