import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function compile(file, deps) {
  const module = { exports: {} };
  const source = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)(name => {
    if (name in deps) return deps[name];
    if (name === "server-only") return {};
    assert.ok(!name.startsWith("@/"), `Unstubbed dependency ${name}`);
    return require(name);
  }, module, module.exports);
  return module.exports;
}

// Use real PostgreSQL for the production NOT NULL constraint and the real
// Supabase SDK to preserve its bulk column-list/NULL semantics over HTTP.
const db = new PGlite();
await db.exec(`create table outreach_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  owner_id uuid not null, visibility text not null, campaign_id uuid,
  prospect_id uuid not null, message_id uuid not null, kind text not null,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz default now()
);`);
const alice = randomUUID(), bob = randomUUID(), workspace = randomUUID(), outside = randomUUID();
let sender = { userId: alice, workspaceId: workspace, senderEmail: "alice@example.invalid", senderName: "Alice" };
let message, enrolment, requests = [], failHistory = false;
const hash = text => createHash("sha256").update(text).digest("hex");
function seed(extra = {}) {
  message = {
    id: randomUUID(), workspace_id: workspace, owner_id: alice, sender_user_id: alice,
    from_email: "alice@example.invalid", campaign_id: randomUUID(), prospect_id: randomUUID(),
    enrolment_id: randomUUID(), message_source: "campaign", status: "approved",
    subject: "A useful introduction", body_text: "Hello. I will not follow up if this is not relevant.",
    voice_script: "Hello, how are you today? We are Interviewa. Reply for a demo.",
    voice_status: "script_ready", voice_script_approved_at: null, strategy: {},
    scheduled_at: "2099-10-26T10:40:00Z", ...extra,
  };
  // A shared campaign can retain the importer as owner. Do not reassign it.
  enrolment = { id: message.enrolment_id, workspace_id: workspace, owner_id: bob, status: "approved" };
  requests = [];
  return message.id;
}
const fetch = async (input, init = {}) => {
  const url = new URL(String(input)), table = url.pathname.split("/").pop();
  const method = init.method || "GET", values = init.body ? JSON.parse(init.body) : null;
  requests.push({ table, method, values, url });
  try {
    if (table === "outreach_events") {
      assert.equal(method, "POST");
      if (failHistory) return Response.json({ code: "XX000", message: "History unavailable" }, { status: 500 });
      const rows = Array.isArray(values) ? values : [values];
      const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
      assert.equal(url.searchParams.get("columns"), columns.map(key => `"${key}"`).join(","));
      const parameters = [];
      const groups = rows.map(row => `(${columns.map(key => {
        parameters.push(key in row ? row[key] : null);
        return `$${parameters.length}`;
      }).join(",")})`);
      await db.query(`insert into outreach_events (${columns.join(",")}) values ${groups.join(",")}`, parameters);
      return new Response(null, { status: 201 });
    }
    assert.ok(["outreach_messages", "outreach_enrolments"].includes(table), "No provider or send endpoint may be called");
    const row = table === "outreach_messages" ? message : enrolment;
    const matches = [...url.searchParams].every(([key, value]) =>
      key === "select" || !value.startsWith("eq.") || String(row[key]) === value.slice(3));
    let data = matches ? structuredClone(row) : null;
    if (method === "PATCH" && matches) { Object.assign(row, values); data = structuredClone(row); }
    const singular = new Headers(init.headers).get("Accept")?.includes("vnd.pgrst.object");
    return Response.json(singular ? data : data ? [data] : []);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};
const client = createClient("https://fixture.invalid", "fixture-key", { global: { fetch } });
const voice = {
  normaliseOutreachVoiceScript: text => String(text || "").trim(),
  outreachVoiceApprovalHash: hash, estimatedVoiceSeconds: () => 50,
  resolveOutreachVoiceConfig: async () => ({ modelId: "fixture-model" }),
  assertOutreachVoiceWithinBudget: () => ({ characters: 700, estimatedCostGbp: 0.04, targetCostGbp: 0.05, maximumCostGbp: 0.075, withinPreferredWordRange: true, overTargetCost: false }),
  OutreachVoiceBudgetError: class extends Error {},
};
const route = compile("app/api/crm/outreach/messages/[id]/route.ts", {
  "next/server": { NextResponse: { json: (data, options) => Response.json(data, options) } },
  "@/lib/supabase": { supabaseAdmin: client },
  "@/lib/outreach-identity": { resolveOutreachIdentity: async () => sender },
  "@/lib/sales-profile": { getOptionalSalesProfile: async () => ({ emailSignoff: "Alice" }) },
  "@/lib/outreach-voice": { removeDashesFromProse: text => text },
  "@/lib/outreach-demo-reply-cta": { ensureOutreachEmailSimpleOptOut: ({ body }) => body },
  "@/lib/outreach-voice-note": voice,
  "@/lib/outreach-voice-policy": { outreachVoiceHasFalseSenderIdentity: () => false },
  "@/lib/outreach-team-safety": { outreachSafetyError: () => null },
});
const patch = (body = {}, id = message.id) => route.PATCH({ json: async () => body }, { params: { id } });
const events = async id => (await db.query("select kind,metadata,owner_id,workspace_id from outreach_events where message_id=$1 order by kind", [id])).rows;

// Prove the fixture reproduces the observed production error before testing the fix.
seed();
const eventBase = { workspace_id: workspace, owner_id: alice, visibility: "team", campaign_id: message.campaign_id, prospect_id: message.prospect_id, message_id: message.id };
const { error: reproduced } = await client.from("outreach_events").insert([
  { ...eventBase, kind: "voice_script_approved", metadata: { scriptHash: hash(message.voice_script) } },
  { ...eventBase, kind: "approved" },
]);
assert.equal(reproduced.code, "23502");
assert.match(reproduced.message, /metadata/);
assert.equal((await events(message.id)).length, 0, "Bulk event writes fail together");

// Exact Kamm path. Already approved and queued email, first voice approval.
const queued = seed();
let response = await patch({ approve_voice_script: true });
let result = await response.json();
assert.equal(response.status, 200, JSON.stringify(result));
assert.ok(result.message.voice_script_approved_at);
assert.equal(result.message.status, "approved");
assert.equal(result.message.scheduled_at, "2099-10-26T10:40:00Z");
assert.equal(result.voiceApproval.estimatedCostGbp, 0.04);
const recorded = await events(queued);
assert.deepEqual(recorded.map(row => row.kind), ["approved", "voice_script_approved"]);
assert.deepEqual(recorded[0].metadata, {});
assert.equal(recorded[1].metadata.scriptHash, hash(message.voice_script));
assert.ok(recorded.every(row => row.owner_id === alice && row.workspace_id === workspace));
assert.equal(enrolment.owner_id, bob, "Do not change campaign ownership");
response = await patch({ approve_voice_script: true });
assert.equal(response.status, 200);
assert.equal((await events(queued)).filter(row => row.kind === "voice_script_approved").length, 1, "Retry never repeats voice approval");

seed({ status: "draft", scheduled_at: null });
response = await patch({ status: "approved", approve_voice_script: true });
assert.equal(response.status, 200, "Email and voice approval together also works");
assert.equal((await events(message.id)).length, 2);
seed({ status: "draft", scheduled_at: null });
response = await patch({ approve_voice_script: true });
assert.equal(response.status, 200);
assert.deepEqual((await events(message.id)).map(row => row.kind), ["voice_script_approved"]);
seed({ status: "draft", voice_script: null, voice_status: "none" });
response = await patch({ status: "approved" });
assert.equal(response.status, 200);
assert.deepEqual((await events(message.id))[0].metadata, {});

seed();
response = await patch({ body_text: `${message.body_text} Updated content.`, approve_voice_script: true });
result = await response.json();
assert.equal(response.status, 200);
assert.equal(result.message.status, "draft", "Changed text still needs email reapproval");
assert.equal(result.message.scheduled_at, null, "Changed text must leave its old send slot");

for (const status of ["sending", "sent"]) {
  seed({ status });
  response = await patch({ approve_voice_script: true });
  assert.equal(response.status, 400);
  assert.ok(requests.every(row => row.method === "GET"), "Never edit or resend a delivered email");
}
for (const override of [{ userId: bob }, { workspaceId: outside }]) {
  seed(); const original = sender; sender = { ...sender, ...override };
  response = await patch({ approve_voice_script: true });
  assert.equal(response.status, 404);
  assert.ok(requests.every(row => row.method === "GET"), "Foreign draft access stays blocked");
  sender = original;
}
seed({ from_email: "another@example.invalid" });
assert.equal((await patch({ approve_voice_script: true })).status, 403);
seed(); failHistory = true;
response = await patch({ approve_voice_script: true });
assert.equal(response.status, 500, "Genuine history failures must not claim success");
failHistory = false;
assert.equal((await patch({ approve_voice_script: true })).status, 200, "A previously partially saved approval can retry without generation");
assert.ok(requests.every(row => ["outreach_messages", "outreach_enrolments", "outreach_events"].includes(row.table)));
await db.close();
console.log("PASS outreach draft save. Reproduced production metadata failure, mixed approvals persist, retries, sender/workspace isolation and sent-message protection. No live writes or provider calls.");
