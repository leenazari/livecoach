import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { validMeetingUrl } from "../lib/meeting-url.ts";
import { browserMeetingLaunchUrl } from "../lib/meeting-account.ts";
import { scheduledCallSessionId } from "../lib/scheduled-call-session.ts";
import { refreshCallPrepContext } from "../lib/call-prep-refresh.ts";
import { captureElapsedSeconds } from "../lib/call-capture-lifecycle.ts";
import { adamPitchContextKey, savedAdamPitch } from "../lib/sales-call-script.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/call/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const pickerModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL('../components/MeetingLeadPicker.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(require, pickerModule, pickerModule.exports);
const meetingLinkModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL('../components/MeetingLaunchLink.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(name => {
  if (name === '@/lib/meeting-account') return { browserMeetingLaunchUrl };
  if (name === '@/lib/meeting-url') return { validMeetingUrl };
  return require(name);
}, meetingLinkModule, meetingLinkModule.exports);
const companyId = "64883abe-8824-450a-a826-e1dbfa9e163f";
const savedFetch = globalThis.fetch;

// Mount the real page, including its parent conditions, navigation and launch
// handlers. Only network/provider boundaries and unrelated child panels are
// stubbed. Testing an isolated start button misses the hidden-parent regression.
for (const scenario of [
  "no-focus", "focus-only", "full-plan", "existing-live", "prep-failed",
  "call-loading", "delayed-call-hydration", "call-denied", "call-mismatch", "stale-meeting", "invalid-meeting", "new-call",
  "lead-choice", "lead-choice-partial",
  "sharon-teams", "cam-teams", "sharon-existing-teams", "cam-existing-teams",
]) {
  const salesperson = scenario.startsWith("sharon") ? "sharon" : scenario.startsWith("cam") ? "cam" : "lee";
  const upcomingId = salesperson === "sharon" ? "46482c8f-182c-46dc-9c25-46ea99fdeb82"
    : salesperson === "cam" ? "46482c8f-182c-46dc-9c25-46ea99fdeb83" : "46482c8f-182c-46dc-9c25-46ea99fdeb81";
  const meetingUrl = scenario.endsWith("teams")
    ? `https://teams.microsoft.com/l/meetup-join/${salesperson}-meeting?context=%7B%22Tid%22%3A%22tenant%22%7D`
    : "https://meet.google.com/abc-defg-hij";
  const existingLive = scenario.includes("existing");
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://crm.test/call${scenario === "new-call" ? "" : `?upcoming=${upcomingId}`}${["call-loading", "delayed-call-hydration", "call-denied", "call-mismatch", "stale-meeting"].includes(scenario) ? "&meetingUrl=https%3A%2F%2Fmeet.google.com%2Fold-link-xxx" : ""}`,
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const requests = [], opened = [], botRequests = [];
  const mountedRooms = [];
  dom.window.open = (...args) => { opened.push(args); return null; };
  let releasePrep;
  const prepPending = new Promise(resolve => { releasePrep = resolve; });
  let releaseCall;
  const callPending = new Promise(resolve => { releaseCall = resolve; });
  const stage = scenario === "focus-only" ? "focus" : scenario === "full-plan" ? "full" : "none";
  const call = {
    id: scenario === "call-mismatch" ? companyId : upcomingId,
    scheduled_at: "2026-11-26T10:30:00Z",
    company_id: companyId, company: "Example Learning",
    title: "Programme review across projects", workstream_id: null,
    primaryAttendee: null,
    meeting_url: scenario === "invalid-meeting" ? "https://invalid.example/meeting" : meetingUrl,
    intent: null, prep: stage === "none" ? null : { planStage: stage },
    workstreamChoices: [
      { id: "project-a", name: "Programme — Recruitment" },
      { id: "project-b", name: "Programme — Teaching" },
    ],
    ...(scenario.startsWith('lead-choice') ? { leadChoices: [{ name: 'Robin', email: 'robin@vendor.test' }, { name: 'Pat', email: 'pat@vendor.test' }], needsLeadConfirmation: true } : {}),
  };
  let leadConfirmed = false;
  const crmFetch = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/crm/ai-mode") return { mode: "economical" };
    if (url === `/api/crm/upcoming/${upcomingId}` && !options) {
      if (scenario === "call-loading") return new Promise(() => {});
      if (scenario === "delayed-call-hydration") await callPending;
      if (scenario === "call-denied") throw new Error("Call unavailable");
      if (leadConfirmed && scenario === 'lead-choice-partial') throw new Error('Read interrupted');
      return { call: structuredClone(call) };
    }
    if (url === `/api/crm/upcoming/${upcomingId}/lead`) {
      assert.equal(JSON.parse(options.body).leadEmail, 'robin@vendor.test');
      leadConfirmed = true;
      call.primaryAttendee = { name: 'Robin', email: 'robin@vendor.test', matchedBy: 'manual_selection' };
      call.needsLeadConfirmation = false;
      call.leadSelectionVersion = 'version';
      call.prep = { candidate: 'Robin', planStage: 'none', selectedComps: [], suggestedComps: [] };
      call.workstream_id = null;
      return { ok: true, notice: 'Lead saved. Matching email context will be used before other history.' };
    }
    if (url === '/api/crm/email-pull') return { ok: true, emailContext: 'Relevant supplier offer for Robin' };
    if (url === `/api/crm/companies/${companyId}`) return {
      company: { name: call.company },
      workstreams: call.workstreamChoices.map(item => ({ ...item, status: "active" })),
    };
    if (url.endsWith("/prep-intent")) {
      if (scenario === "prep-failed") throw new Error("Intent service unavailable");
      await prepPending;
      if (leadConfirmed) return { intent: 'Evaluate the supplier offer with Robin' };
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
      mountedRooms.push(props.room);
      if (existingLive) props.onSessionRecovered(props.room, true);
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
    if (name === "@/hooks/useSalesCallPlan") return { useSalesCallPlan: () => ({products:[],choose(){},stage:"hook",setStage(){},status:"Saved",ready:true,improvement:"",retry(){},scriptRef:{current:{products:[],stage:"hook"}}}) };
    if (name === "@/lib/sales-call-script") return { isSpokenObjection: () => false, adamPitchContextKey, savedAdamPitch };
    if (name === "@/lib/crm") return { crmFetch, crmConfirmationError: () => new Error("Not confirmed") };
    if (name === "@/lib/call-prep-refresh") return { refreshCallPrepContext };
    if (name === "@/lib/call-capture-lifecycle") return { captureElapsedSeconds };
    if (name === "@/lib/meeting-url") return { validMeetingUrl };
    if (name === "@/lib/meeting-account") return { browserMeetingLaunchUrl };
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
    if (name === '@/components/MeetingLeadPicker') return pickerModule.exports;
    if (name === '@/components/MeetingLaunchLink') return meetingLinkModule.exports;
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
    if (scenario === "delayed-call-hydration") {
      assert.deepEqual(mountedRooms, [], "A meeting URL cannot activate the temporary room while call details are loading");
      await act(async () => releaseCall());
    }
    if (["call-loading", "call-denied", "call-mismatch"].includes(scenario)) {
      assert.deepEqual(mountedRooms, [], "An unverified scheduled call cannot mount its transcript listener");
    } else if (scenario !== "new-call") {
      assert.deepEqual(mountedRooms, [scheduledCallSessionId(upcomingId, call.scheduled_at)], "Only the verified occurrence room is connected, before slow prep completes");
    }
    if (existingLive) {
      assert.ok(button("Exit full screen"), "Recovered live call automatically expands suggestions");
      const meetingLink = document.querySelector('a[data-meeting-launch]');
      assert.ok(meetingLink, "An automatically started call must still offer the actual meeting link");
      assert.equal(meetingLink.getAttribute("href"), browserMeetingLaunchUrl(meetingUrl));
      assert.equal(meetingLink.target, "_blank");
      assert.equal(meetingLink.rel, "noopener noreferrer");
      await click(button("Exit full screen"));
    }
    const dock = document.querySelector('[aria-label="Call actions"]');
    assert.ok(dock, `${scenario} has visible call actions without requiring focus`);
    const live = button("Live", document.querySelector("nav"));
    const preCall = button("Pre-call brief", document.querySelector("nav"));
    assert.equal(preCall.disabled, stage !== "full", "Only the brief needs a completed plan");

    if (scenario.startsWith('lead-choice')) {
      await act(async () => releasePrep());
      assert.match(document.body.textContent, /Who is leading this conversation/);
      const select = document.querySelector('select[aria-label="Meeting lead"]');
      await act(async () => { select.value = 'robin@vendor.test'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
      await click(button('Use this lead'));
      assert.equal(leadConfirmed, true);
      if (scenario === 'lead-choice') {
        assert.match(document.body.textContent, /Preparing for Robin/);
        assert.match(document.body.textContent, /Your choice is saved for this meeting/);
        assert.ok([...document.querySelectorAll('textarea')].some(el => el.value === 'Evaluate the supplier offer with Robin'));
      } else assert.match(document.body.textContent, /Your lead was saved, but the updated prep could not be loaded/);
      assert.equal(opened.length, 0, 'Lead selection never opens or starts a meeting');
      assert.equal(botRequests.length, 0);
    } else if (["call-loading", "call-denied", "call-mismatch"].includes(scenario)) {
      assert.equal(live.disabled, true, "Unverified scheduled call cannot start");
      const blockedStart = button("Open meeting + start", dock) || button("Start call", dock);
      assert.ok(blockedStart, "The disabled start control stays visible while verifying the meeting");
      assert.equal(blockedStart.disabled, true);
      assert.equal(opened.length, 0);
    } else if (existingLive) {
      assert.match(dock.textContent, /Call live/);
      const meetingLink = dock.querySelector('a[data-meeting-launch]');
      assert.ok(meetingLink, "The meeting link also stays available outside expanded coaching");
      assert.equal(meetingLink.getAttribute("href"), browserMeetingLaunchUrl(meetingUrl));
      // A normal anchor opens only the provider. It must not send another bot,
      // rewrite prep or mutate the recovered session.
      meetingLink.addEventListener("click", event => event.preventDefault());
      await act(async () => meetingLink.click());
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
        assert.ok(button("Exit full screen"), "Starting automatically expands suggestions");
        const meetingLink = document.querySelector('a[data-meeting-launch]');
        if (scenario === "new-call") assert.equal(meetingLink, null, "An in-app call has no external meeting link");
        else {
          assert.ok(meetingLink, "A direct meeting link remains available even when window.open returns null");
          assert.equal(meetingLink.getAttribute("href"), browserMeetingLaunchUrl(meetingUrl));
          if (scenario.endsWith("teams")) assert.match(meetingLink.textContent, /Open Teams/);
        }
        await click(button("Exit full screen"));
        assert.match(document.querySelector('[aria-label="Call actions"]').textContent, /Call live/);
        assert.equal(opened.length, scenario === "new-call" ? 0 : 1);
        if (scenario !== "new-call") {
          assert.deepEqual(opened[0], [browserMeetingLaunchUrl(meetingUrl), "_blank", "noopener,noreferrer"]);
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
