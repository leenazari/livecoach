import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { validMeetingUrl } from "../lib/meeting-url.ts";
import { scheduledCallSessionId } from "../lib/scheduled-call-session.ts";
import { refreshCallPrepContext } from "../lib/call-prep-refresh.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/call/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const upcomingId = "46482c8f-182c-46dc-9c25-46ea99fdeb81";
const companyId = "64883abe-8824-450a-a826-e1dbfa9e163f";
const meetingUrl = "https://meet.google.com/abc-defg-hij";
const savedFetch = globalThis.fetch;

// Mount the real page, including its parent conditions, navigation and launch
// handlers. Only network/provider boundaries and unrelated child panels are
// stubbed. Testing an isolated start button misses the hidden-parent regression.
for (const scenario of [
  "no-focus", "focus-only", "full-plan", "existing-live", "prep-failed",
  "call-loading", "call-denied", "call-mismatch", "stale-meeting", "invalid-meeting", "new-call",
]) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://crm.test/call${scenario === "new-call" ? "" : `?upcoming=${upcomingId}`}${scenario === "stale-meeting" ? "&meetingUrl=https%3A%2F%2Fmeet.google.com%2Fold-link-xxx" : ""}`,
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const requests = [], opened = [], botRequests = [];
  dom.window.open = (...args) => { opened.push(args); return null; };
  let releasePrep;
  const prepPending = new Promise(resolve => { releasePrep = resolve; });
  const stage = scenario === "focus-only" ? "focus" : scenario === "full-plan" ? "full" : "none";
  const call = {
    id: scenario === "call-mismatch" ? companyId : upcomingId,
    company_id: companyId, company: "Example Learning",
    title: "Programme review across projects", workstream_id: null,
    primaryAttendee: null,
    meeting_url: scenario === "invalid-meeting" ? "https://invalid.example/meeting" : meetingUrl,
    intent: null, prep: stage === "none" ? null : { planStage: stage },
    workstreamChoices: [
      { id: "project-a", name: "Programme — Recruitment" },
      { id: "project-b", name: "Programme — Teaching" },
    ],
  };
  const crmFetch = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/crm/ai-mode") return { mode: "economical" };
    if (url === `/api/crm/upcoming/${upcomingId}` && !options) {
      if (scenario === "call-loading") return new Promise(() => {});
      if (scenario === "call-denied") throw new Error("Call unavailable");
      return { call };
    }
    if (url === `/api/crm/companies/${companyId}`) return {
      company: { name: call.company },
      workstreams: call.workstreamChoices.map(item => ({ ...item, status: "active" })),
    };
    if (url.endsWith("/prep-intent")) {
      if (scenario === "prep-failed") throw new Error("Intent service unavailable");
      await prepPending;
      return { intent: "", needsIdentityConfirmation: true, notice: "Confirm the meeting context or enter your own intent." };
    }
    if (url === "/api/crm/link-session") return { ok: true };
    throw new Error(`Unexpected CRM request ${url}`);
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/interview/session") return Response.json({ ok: true });
    throw new Error(`Unexpected network request ${url}`);
  };
  const Empty = () => null;
  const MockMeetStage = props => {
    React.useEffect(() => {
      if (scenario === "existing-live") props.onSessionRecovered(props.room, true);
    }, []);
    React.useEffect(() => {
      if (props.startRequest) botRequests.push(props.startRequest);
    }, [props.startRequest]);
    return null;
  };
  const module = { exports: {} };
  const dependency = name => {
    if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
    if (name === "next/dynamic") return { default: loader =>
      String(loader).includes("MeetStage") ? MockMeetStage : Empty };
    if (name === "@/lib/crm") return { crmFetch, crmConfirmationError: () => new Error("Not confirmed") };
    if (name === "@/lib/call-prep-refresh") return { refreshCallPrepContext };
    if (name === "@/lib/meeting-url") return { validMeetingUrl };
    if (name === "@/lib/scheduled-call-session") return { scheduledCallSessionId };
    if (name === "@/lib/call-launch") return { consumeArmedCallLaunch: () => false };
    if (name === "@/lib/calendar-subject") return { pickPrimaryAttendee: () => null };
    if (name === "@/lib/research-format") return { cleanResearchBackground: value => value };
    if (name === "@/lib/live-focus-cue") return { validateRequestedFocus: () => null };
    if (name === "@/lib/dictation") return {};
    if (name === "@/lib/costs") return {
      estimateCost: () => ({ totalGBP: 0 }), projectHourlyGBP: () => 0,
      knowledgeTokensFromText: () => 0, HOURLY_CEILING_GBP: 10,
    };
    if (name === "@/components/crm/CallActionDock") return { default: props =>
      React.createElement("div", { role: "region", "aria-label": "Call actions" }, props.children) };
    if (name.startsWith("@/components/")) return { default: Empty };
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(dependency, module, module.exports);
  const root = createRoot(document.getElementById("root"));
  const button = (text, parent = document) => [...parent.querySelectorAll("button")].find(el => el.textContent.includes(text));
  const click = async (el, count = 1) => {
    assert.ok(el, `${scenario} control is visible`);
    assert.equal(el.disabled, false, `${scenario} control is enabled`);
    await act(async () => { for (let i = 0; i < count; i++) el.click(); });
  };
  try {
    await act(async () => root.render(React.createElement(module.exports.default)));
    const dock = document.querySelector('[aria-label="Call actions"]');
    assert.ok(dock, `${scenario} has visible call actions without requiring focus`);
    const live = button("Live", document.querySelector("nav"));
    const preCall = button("Pre-call brief", document.querySelector("nav"));
    assert.equal(preCall.disabled, stage !== "full", "Only the brief needs a completed plan");

    if (["call-loading", "call-denied", "call-mismatch"].includes(scenario)) {
      assert.equal(live.disabled, true, "Unverified scheduled call cannot start");
      assert.equal(button("Start call", dock).disabled, true);
      assert.equal(opened.length, 0);
    } else if (scenario === "existing-live") {
      assert.match(dock.textContent, /Call live/);
      await click(button("Intent & focus", document.querySelector("nav")));
      assert.ok(document.getElementById("call-setup"), "Can review setup during a live call");
      await click(button("Live", document.querySelector("nav")));
      assert.equal(document.getElementById("call-setup"), null, "Return to live collapses setup without a plan");
      assert.equal(opened.length, 0, "Returning to live never opens another provider tab");
      assert.equal(botRequests.length, 0, "Recovery/navigation never requests another bot");
      assert.equal(requests.some(item => item.url === "/api/interview/session"), false, "Recovery does not overwrite saved session context");
    } else {
      // This runs while intent generation is still pending, as well as when it
      // failed. Neither may stop a manually requested, verified call launch.
      assert.equal(live.disabled, false);
      if (scenario === "no-focus") {
        assert.equal(document.querySelector('[aria-label="Choose the relationship for this call"]').value, "");
        assert.match(document.body.textContent, /Project \(optional\)/);
      }
      const start = scenario === "focus-only" ? live : button(scenario === "new-call" ? "Start call" : "Open meeting + start", dock);
      await click(start, scenario === "no-focus" ? 2 : 1);
      if (scenario === "invalid-meeting") {
        assert.match(document.body.textContent, /add a supported Teams, Meet or Zoom link/);
        assert.equal(opened.length, 0);
        assert.equal(botRequests.length, 0);
      } else {
        assert.match(document.querySelector('[aria-label="Call actions"]').textContent, /Call live/);
        assert.equal(opened.length, scenario === "new-call" ? 0 : 1);
        if (scenario !== "new-call") {
          assert.deepEqual(opened[0], [meetingUrl, "_blank", "noopener,noreferrer"]);
          assert.deepEqual(botRequests, [1]);
        }
        await click(button("Intent & focus", document.querySelector("nav")));
        await click(button("Live", document.querySelector("nav")));
        assert.equal(opened.length, scenario === "new-call" ? 0 : 1, "Returning to live cannot repeat launch");
      }
    }
    assert.equal(requests.some(item => item.url === "/api/interview/plan"), false, "Starting never generates focus or a plan");
    assert.equal(requests.some(item => item.options?.body?.includes('"workstreamId":"project-')), false, "Multi-project meetings do not select an arbitrary workstream");
  } finally {
    await act(async () => { releasePrep(); });
    await act(async () => root.unmount());
    dom.window.close();
  }
}
globalThis.fetch = savedFetch;
console.log("Full call page without focus, pending/failed prep, live return, identity/link guards and multi-project navigation passed");
