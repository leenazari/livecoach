import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const digest = read("app/api/cron/daily-digest/route.ts");
const calendar = read("app/api/crm/calendar-sync/route.ts");
const start = calendar.indexOf("export async function POST(");
const end = calendar.indexOf("async function runQueuedCalendarSync(", start);
assert.ok(start >= 0 && end > start);
const postSource = stripTypeScriptTypes(calendar.slice(start, end).replace("export ", ""));
const scope = new AsyncLocalStorage();
const verifiedMemberships = new Set();
const membershipChecks = [];
let browserScope;
let serviceRequest = true;
class NextRequest extends Request {
  get nextUrl() { return new URL(this.url); }
}
const NextResponse = { json: (data, init) => Response.json(data, init) };
const supabaseService = {
  from(table) {
    assert.equal(table, "workspace_members");
    const filters = {};
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      async maybeSingle() {
        membershipChecks.push({ ...filters });
        assert.equal(filters.status, "active");
        return {
          data: verifiedMemberships.has(`${filters.workspace_id}:${filters.user_id}`)
            ? { user_id: filters.user_id } : null,
          error: null,
        };
      },
    };
    return query;
  },
};
const POST = new Function("NextResponse", "isVerifiedServiceRequest", "supabaseService",
  "runWithServiceRecordScope", "runQueuedCalendarSync", `${postSource}; return POST;`)(
  NextResponse, () => serviceRequest, supabaseService,
  (account, work) => scope.run(account, work),
  async mode => {
    await Promise.resolve();
    const account = scope.getStore() || browserScope;
    return Response.json({ ok: true, reconciled: true, mode, account });
  }
);

// Execute the actual digest-to-calendar handoff against the actual calendar
// POST entry point. A missing body used to return HTTP 400 before any email.
const callStart = digest.indexOf("const syncResponse = await runCalendarSync(");
const callEnd = digest.indexOf("const syncResult =", callStart);
assert.ok(callStart >= 0 && callEnd > callStart);
const handoffSource = stripTypeScriptTypes(digest.slice(callStart, callEnd));
const handoff = new Function("NextRequest", "req", "account", "runCalendarSync",
  `return (async () => { ${handoffSource}; return syncResponse; })();`);
const request = new NextRequest("https://crm.test/api/cron/daily-digest?account=ignored");
const alice = { userId: "11111111-1111-4111-8111-111111111111", workspaceId: "33333333-3333-4333-8333-333333333333" };
const bob = { userId: "22222222-2222-4222-8222-222222222222", workspaceId: alice.workspaceId };
for (const account of [alice, bob]) verifiedMemberships.add(`${account.workspaceId}:${account.userId}`);
const results = await Promise.all([alice, bob].map(async account => {
  const response = await handoff(NextRequest, request, account, POST);
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.deepEqual(result.account, account, "Concurrent digests must sync only their exact account");
  return result;
}));
assert.equal(results.length, 2);
assert.equal(membershipChecks.length, 2);
assert.equal(scope.getStore(), undefined, "Account scope cannot leak after the handoff");

// The fix must supply identity to the existing gate, never weaken that gate.
assert.equal((await POST()).status, 400);
assert.equal((await POST(new NextRequest("https://crm.test/api/crm/calendar-sync", {
  method: "POST", body: "invalid JSON",
}))).status, 400);
const wrongWorkspace = { ...alice, workspaceId: "44444444-4444-4444-8444-444444444444" };
assert.equal((await handoff(NextRequest, request, wrongWorkspace, POST)).status, 403);
const removed = { ...alice, userId: "55555555-5555-4555-8555-555555555555" };
assert.equal((await handoff(NextRequest, request, removed, POST)).status, 403);
serviceRequest = false;
browserScope = alice;
const browserResult = await (await POST(new NextRequest("https://crm.test/api/crm/calendar-sync?mode=near-term"))).json();
assert.deepEqual(browserResult.account, alice);
assert.equal(browserResult.mode, "near-term");
console.log("Digest calendar handoff passed: concurrent exact-account sync, active-membership checks, invalid/missing identity rejection, and browser refresh preserved. Provider calls simulated.");
