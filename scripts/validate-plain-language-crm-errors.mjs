import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
function compile(file, deps = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", source)(name => {
    if (name in deps) return deps[name];
    assert.ok(!name.startsWith("@/"), `Unstubbed dependency ${name}`);
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const blockers = compile("lib/crm-blocker.ts");
const fallback = (input = {}) => blockers.crmFallbackBlockerPayload({ status: 500, url: "/api/crm/outreach/messages/example", method: "PATCH", ...input });
for (const serverMessage of ["Bad Request", "500 Internal Server Error", "Bad Gateway", "Service unavailable", "failed to save draft", { message: "private error" },
  'null value in column "metadata" of relation "outreach_events" violates not-null constraint',
  '<!DOCTYPE html><html><body>proxy fault</body></html>', 'TypeError with private internal data',
  "access_token=do-not-display", "x".repeat(510) + " refresh_token=do-not-display"]) {
  const result = fallback({ serverMessage });
  assert.equal(result.blocker.reason, "A server problem prevented LiveCoach from confirming the result.");
  assert.match(result.blocker.outcome, /may already be saved/);
  assert.doesNotMatch(result.error, /not-null|private error|do-not-display|<html|\[object Object\]/);
}
const validation = fallback({ status: 400, serverMessage: "Enter the recipient's work email" });
assert.match(validation.blocker.reason, /recipient's work email/);
assert.equal(validation.blocker.responsible, "user");
assert.match(fallback({ status: 400, serverMessage: "Bad Request" }).blocker.reason, /missing or invalid/);
for (const status of [0, 408, 500, 502, 504]) {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const result = fallback({ status, method });
    assert.match(result.blocker.outcome, /may already/);
    assert.match(result.blocker.nextAction, /Copy any unsaved text/);
    assert.doesNotMatch(result.error, /nothing changed|not saved|try once more/i);
  }
  const read = fallback({ status, method: "GET" });
  assert.match(read.blocker.outcome, /may be out of date/);
  assert.doesNotMatch(read.error, /action not confirmed|may already be saved/i);
  const send = fallback({ status, method: "POST", url: "/api/crm/outreach/messages/example/send?attempt=1" });
  assert.match(send.blocker.nextAction, /Do not send another copy/);
  assert.match(send.blocker.nextAction, /already queued or sent/);
  assert.equal(send.blocker.code, `crm_outreach_${status || "network"}`, "Support codes stay stable");
  const voice = fallback({ status, url: "/api/crm/outreach/messages/example/voice", method: "POST" });
  assert.match(voice.blocker.nextAction, /another charge/);
}
for (const status of [403, 404]) {
  const error = fallback({ status });
  assert.equal(error.blocker.responsible, "owner");
  assert.doesNotMatch(error.error, /another user owns|exists in another workspace|may already/);
}
assert.match(fallback({ status: 401 }).blocker.nextAction, /Copy any unsaved text.*sign in again/);
assert.match(fallback({ status: 429 }).blocker.nextAction, /daily limit.*resets/);
assert.doesNotMatch(fallback({ status: 429 }).error, /one minute/);
assert.match(fallback({ url: "/api/crm/outreach?query=/companies/private", method: "GET" }).blocker.title, /^Outreach/);
const precise = blockers.crmBlockerPayload({
  code: "outreach_draft_history_incomplete", title: "Draft saved, but a follow-up step failed",
  reason: "The activity history could not be updated", outcome: "Your draft changes were saved",
  nextAction: "Reopen the draft and check its send status", responsible: "system",
  reference: "12345678-1111-4111-8111-111111111111",
});
assert.match(precise.error, /Your draft changes were saved/);

// Exercise the actual fetch wrapper and alert. No application server or real
// records/providers are contacted, and no error retries the mutation.
const dom = new JSDOM('<div id="root"></div>', { url: "https://crm.test" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const diagnostics = [];
const crm = compile("lib/crm.ts", {
  "@/lib/crm-blocker": blockers,
  "@/lib/crm-blocker-diagnostics": { reportCrmBlocker: (...args) => diagnostics.push(args) },
});
const Alert = compile("components/crm/CrmBlockerAlert.tsx", { "@/lib/crm": crm }).default;
const root = createRoot(document.getElementById("root"));
await act(async () => root.render(React.createElement(Alert)));
let calls = 0;
globalThis.fetch = async () => { calls++; return Response.json(precise, { status: 500 }); };
crm.setCached("/api/crm/outreach/messages", { old: true });
await act(async () => {
  await assert.rejects(() => crm.crmFetch("/api/crm/outreach/messages/example", { method: "PATCH", body: "{}" }), error => {
    assert.equal(error.blocker.reference, precise.blocker.reference);
    assert.equal(error.blocker.outcome, precise.blocker.outcome);
    return true;
  });
});
assert.equal(calls, 1, "Do not automatically retry a partially saved action");
assert.equal(crm.getCached("/api/crm/outreach/messages"), undefined, "Do not reopen a stale pre-save snapshot");
const alert = document.querySelector('[role="alert"]');
assert.match(alert.textContent, /Action needs attention/);
assert.match(alert.textContent, /What happened/);
assert.match(alert.textContent, /What this means for your work.*Your draft changes were saved/);
assert.doesNotMatch(alert.textContent, /Action not completed/);
assert.equal(alert.querySelector("details").open, false, "Support details are secondary");
assert.match(alert.querySelector("details").textContent, /outreach_draft_history_incomplete/);
assert.ok(alert.className.includes("overflow-y-auto"), "Long mobile errors can scroll");
await act(async () => alert.querySelector("button").click());
assert.equal(document.querySelector('[role="alert"]'), null);

for (const mode of ["lost headers", "lost body", "invalid body"]) {
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (mode === "lost headers") throw Error("private transport detail");
    if (mode === "lost body") return { ok: true, status: 200, text: async () => { throw Error("private transport detail"); } };
    return new Response("<html>proxy error</html>", { status: 502 });
  };
  await act(async () => {
    await assert.rejects(() => crm.crmFetch("/api/crm/outreach/messages/example/send", { method: "POST", body: "{}" }), error => {
      assert.equal(error.name, "CrmRequestError");
      assert.match(error.message, /Do not send another copy/);
      assert.doesNotMatch(error.message, /private transport detail|<html>/);
      return true;
    });
  });
  assert.equal(calls, 1);
}
await act(async () => document.querySelector('[role="alert"] button').click());
globalThis.fetch = async () => Response.json({ error: "Bad Request" }, { status: 500 });
await act(async () => assert.rejects(() => crm.crmFetch("/api/crm/outreach"), /could not be loaded.*Support code crm_outreach_500/));
assert.equal(document.querySelector('[role="alert"]'), null, "Background reads stay inline, not interrupting popups");
assert.equal(crm.getCached("/api/crm/outreach"), undefined, "A failed read must not be cached as an empty list");
globalThis.fetch = async () => Response.json({ ok: true, created: false, refreshed: true });
const refresh = await crm.crmFetch("/api/crm/email-pull", { method: "POST", body: "{}" });
assert.equal(refresh.refreshed, true, "Refreshing an existing record is still a success");
assert.equal(document.querySelector('[role="alert"]'), null);
await act(async () => root.unmount());
dom.window.close();
console.log("PASS plain-language CRM errors. Operation-specific copy, honest outcomes, safe retries, private details, real fetch/alert behavior, interrupted responses and successful refreshes.");
