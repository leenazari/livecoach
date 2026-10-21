import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const Empty = () => null;
function compile(file, replacements = {}, modules = {}) {
  if (modules[file]) return modules[file].exports;
  const module = modules[file] = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const dependency = name => {
    if (name in replacements) return replacements[name];
    if (name === "next/dynamic") return { default: () => Empty };
    if (name === "next/link") return { default: props => React.createElement("a", props) };
    if (name === "@/components/crm/CanonicalRecordLink") return { default: props => React.createElement("a", { href: props.href }, props.children) };
    if (name.startsWith("@/components/")) return { default: Empty };
    if (name.startsWith("@/lib/")) return compile(`${name.replace("@/", "")}.ts`, replacements, modules);
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(dependency, module, module.exports);
  return module.exports;
}
function setup() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://crm.test/crm/outreach?tab=prospects", pretendToBeVisual: true,
  });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  // Do not run speculative idle prefetch in these deterministic UI checks.
  dom.window.requestIdleCallback = () => 1;
  dom.window.cancelIdleCallback = () => {};
  return { dom, root: createRoot(document.getElementById("root")) };
}
const prospect = {
  id: "prospect-one", first_name: "Alex", last_name: "Example", company_name: "Example Engineering",
  email: "alex@example.test", priority: "high", status: "new", assigned_to_user_id: "user-one",
  recommendation: { action: "hold", label: "Hold", score: 50, confidence: "high", reasons: [], risks: [] },
};
const prospectPayload = { prospects: [prospect], currentUser: "user-one", canManageAssignments: false };
const button = text => [...document.querySelectorAll("button")].find(el => el.textContent === text);
const tabButton = text => [...document.querySelectorAll("nav button")].find(el => el.textContent.includes(text));
const click = async el => {
  assert.ok(el, "Control is visible");
  assert.equal(el.disabled, false);
  await act(async () => el.click());
};

for (const cached of [false, true]) {
  const { dom, root } = setup();
  const cache = new Map(cached ? [["/api/crm/outreach", prospectPayload]] : []);
  let fail = true;
  let empty = false;
  const requests = [];
  const crmFetch = async (url, options) => {
    requests.push({ url, method: options?.method || "GET" });
    if (options?.method) throw new Error("The queue action was not saved");
    let data = {};
    if (url === "/api/crm/outreach") {
      if (fail) throw new Error("CRM action not confirmed. Bad Request.");
      data = empty ? { ...prospectPayload, prospects: [] } : prospectPayload;
    }
    if (url === "/api/crm/outreach/research-jobs") data = { jobs: [], revision: "1" };
    cache.set(url, data);
    return data;
  };
  const page = compile("app/crm/outreach/page.tsx", {
    "@/lib/crm": { crmFetch, getCached: url => cache.get(url), crmConfirmationError: () => new Error("Not saved") },
  });
  try {
    await act(async () => root.render(React.createElement(page.default)));
    // A seeded cached list doesn't re-fetch on mount. Force a revalidation via
    // navigation, like the real cache expiring while the user stays on the page.
    if (cached) {
      await click(tabButton("Today"));
      cache.delete("/api/crm/outreach");
      await click(tabButton("Prospects"));
    }
    assert.match(document.body.textContent, /Prospects could not load/);
    assert.doesNotMatch(document.body.textContent, /No prospects match these filters/);
    if (cached) {
      assert.match(document.body.textContent, /Previously loaded results/);
      assert.match(document.body.textContent, /Example Engineering/);
    } else {
      assert.match(document.body.textContent, /list has not loaded yet/);
      assert.equal(document.querySelector('[placeholder^="Search person"]'), null);
    }
    await click(button("Retry prospects"));
    assert.match(document.body.textContent, /Prospects could not load/, "Repeated failures remain recoverable");

    await click(tabButton("Today"));
    assert.doesNotMatch(document.body.textContent, /Prospects could not load/, "An unrelated tab must not inherit this read error");
    await click([...document.querySelectorAll("button")].find(el => el.textContent.startsWith("Choose today's contacts")));
    assert.match(document.body.textContent, /The queue action was not saved/);
    await click(tabButton("Prospects"));
    const writesBefore = requests.filter(r => r.method !== "GET").length;
    fail = false;
    await click(button("Retry prospects"));
    assert.doesNotMatch(document.body.textContent, /Prospects could not load|Bad Request/);
    assert.match(document.body.textContent, /Example Engineering/);
    assert.match(document.body.textContent, /The queue action was not saved/, "Successful reads cannot erase a failed write receipt");
    assert.equal(requests.filter(r => r.method !== "GET").length, writesBefore, "Retry must not send or enqueue anything");
    const search = document.querySelector('[placeholder^="Search person"]');
    const readCount = requests.length;
    await act(async () => Simulate.change(search, { target: { value: "engineering" } }));
    assert.match(document.body.textContent, /Example Engineering/);
    await act(async () => Simulate.change(search, { target: { value: "no-match" } }));
    assert.match(document.body.textContent, /No prospects match these filters/);
    assert.equal(requests.length, readCount, "Typing searches the verified loaded data without a new API request");
    await act(async () => Simulate.change(search, { target: { value: "" } }));
    await click(tabButton("Today"));
    cache.delete("/api/crm/outreach");
    empty = true;
    await click(tabButton("Prospects"));
    assert.match(document.body.textContent, /No prospects match these filters/, "A genuinely successful empty response still shows the empty state");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
}

// Retrying a failed core GET cannot become an automatic queue mutation even
// when the recovered response contains an active, under-filled campaign.
{
  const { dom, root } = setup();
  dom.window.history.replaceState({}, "", "/crm/outreach");
  let fail = true;
  const methods = [];
  const page = compile("app/crm/outreach/page.tsx", { "@/lib/crm": {
    getCached: () => undefined,
    crmFetch: async (url, options) => {
      methods.push(options?.method || "GET");
      if (url === "/api/crm/outreach/queue" && fail) throw Error("Bad Request");
      if (url === "/api/crm/outreach/campaigns") return {
        selectedCampaignId: "campaign", campaigns: [{ id: "campaign", name: "Test", status: "active", daily_limit: 50, sequence: [] }],
      };
      return { jobs: [], queue: [] };
    },
  } });
  try {
    await act(async () => root.render(React.createElement(page.default)));
    assert.match(document.body.textContent, /Queue and campaigns could not load/);
    fail = false;
    await click(button("Retry queue and campaigns"));
    assert.doesNotMatch(document.body.textContent, /Queue and campaigns could not load/);
    assert.ok(methods.every(method => method === "GET"), "Read recovery never auto-fills the queue");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
}

// Verify stale responses and errors cannot win a race against a newer retry.
const { dom, root } = setup();
const { useOutreachLoads } = compile("lib/use-outreach-loads.ts");
let state;
let saved;
function Harness() { state = useOutreachLoads(); return null; }
try {
  await act(async () => root.render(React.createElement(Harness)));
  let rejectOld, resolveOld;
  const deferred = new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
  let pending;
  await act(async () => { pending = state.load("prospects", () => deferred, value => { saved = value; }); });
  await act(async () => state.load("metrics", async () => { throw Error("Activity unavailable"); }, () => {}));
  await act(async () => state.load("prospects", async () => "new", value => { saved = value; }));
  await act(async () => { rejectOld(Error("Old failure")); await pending; });
  assert.equal(saved, "new");
  assert.equal(state.errors.prospects, undefined);
  assert.equal(state.errors.metrics, "Activity unavailable");
  const staleSuccess = new Promise(resolve => { resolveOld = resolve; });
  await act(async () => { pending = state.load("prospects", () => staleSuccess, value => { saved = value; }); });
  await act(async () => state.load("prospects", async () => "newest", value => { saved = value; }));
  await act(async () => { resolveOld("stale"); await pending; });
  assert.equal(saved, "newest");
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
console.log("Outreach load recovery passed. Real page retry, cache recovery, empty states, local search, isolated read/write errors and response races verified.");
