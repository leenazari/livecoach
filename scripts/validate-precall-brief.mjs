import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const scheduled = { id: "call", company_id: "company", workstream_id: "thread" };
let owned = true;
let matched = "thread";
let reads = [];
const fixtures = {
  upcoming_calls: () => owned ? scheduled : null,
  interview_summaries: () => ({ id: "prior", created_at: "2026-11-24", summary: { headline: "Agreed a pilot", notCovered: ["Who signs off on the pilot"] } }),
  tasks: () => [{ id: "task", text: "Send pilot scope", due_at: null }],
  workstreams: () => ({ email_context: "Another contact's email", email_context_meta: { email_context_counterparty_email: "other@example.test" } }),
};
const deps = {
  "next/server": { NextResponse: { json: (body, options) => ({ body, ...options }) } },
  "@/lib/request-scope": { requireRequestScope: () => ({ workspaceId: "workspace", userId: "rep" }) },
  "@/lib/uuid": { isUuid: () => true },
  "@/lib/call-subject": { resolveCallLead: async () => ({
    primaryAttendee: { email: "contact@example.test" },
    leadChoices: [{ name: "Contact" }],
    meetingEmail: null,
  }) },
  "@/lib/workstreams": { resolveWorkstreamFromAttendees: async ({ attendees }) => {
    assert.equal(attendees[0].email, "contact@example.test");
    return matched ? { id: matched, companyId: "company" } : null;
  } },
  "@/lib/supabase": { supabaseAdmin: { from(table) {
    const filters = {};
    const query = {
      select: () => query,
      eq: (field, value) => { filters[field] = value; return query; },
      order: () => query,
      limit: () => query,
      maybeSingle: () => query,
      then(resolve) {
        reads.push(table);
        assert.equal(filters.workspace_id, "workspace");
        assert.equal(filters.owner_id, "rep");
        if (table === "tasks" || table === "interview_summaries") {
          assert.equal(filters.workstream_id, "thread");
          assert.equal(filters.company_id, "company");
        }
        resolve({ data: fixtures[table](), error: null });
      },
    };
    return query;
  } } },
};
const mod = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../app/api/crm/upcoming/[id]/brief/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "module", "exports", code)(name => deps[name], mod, mod.exports);
const get = () => mod.exports.GET(null, { params: { id: "call" } });
const good = await get();
assert.equal(good.status, 200);
assert.equal(good.body.lastCall.id, "prior");
assert.equal(good.body.promises[0].id, "task");
assert.equal(good.body.email, null, "Never reuse another counterparty’s email");
for (const thread of [null, "another-thread"]) {
  reads = [];
  matched = thread;
  const result = await get();
  assert.equal(result.body.lastCall, null);
  assert.deepEqual(result.body.promises, []);
  assert.deepEqual(reads, ["upcoming_calls"]);
}
owned = false;
assert.equal((await get()).status, 404);
console.log("Pre-call brief: scoped history, unmatched contact, stale workstream and unowned event checks passed");
