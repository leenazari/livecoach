import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { validMeetingUrl } from "../lib/meeting-url.ts";
import { browserMeetingLaunchUrl } from "../lib/meeting-account.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.equal(
  validMeetingUrl("https://teams.microsoft.com/l/meetup-join/example"),
  true
);
assert.equal(validMeetingUrl("https://meet.google.com/abc-defg-hij"), true);
assert.equal(validMeetingUrl("https://company.zoom.us/j/123456789"), true);
assert.equal(validMeetingUrl("http://teams.microsoft.com/l/meetup-join/x"), false);
assert.equal(validMeetingUrl("https://teams.microsoft.com.evil.example/x"), false);
assert.equal(validMeetingUrl("https://example.com/meeting"), false);

const launch = read("lib/call-launch.ts");
const upcoming = read("components/crm/UpcomingCalls.tsx");
const prep = read("app/crm/prep/page.tsx");
const call = read("app/call/page.tsx");
const meetStage = read("components/MeetStage.tsx");
const startRoute = read("app/api/meet/start/route.ts");

// An auto-start is authorised by a fresh browser-session marker tied to the
// exact scheduled call and link, never by a copied query string alone.
assert.match(launch, /MAX_AGE_MS = 2 \* 60 \* 1000/);
assert.match(launch, /sessionStorage\.setItem/);
assert.match(launch, /sessionStorage\.removeItem/);
assert.match(launch, /pending\.upcomingId === upcomingId\.trim\(\)/);
assert.match(launch, /pending\.meetingUrl === meetingUrl\.trim\(\)/);
assert.match(launch, /window\.open\(browserMeetingLaunchUrl\(cleanUrl\), "_blank", "noopener,noreferrer"\)/);

// The dashboard opens the meeting inside the direct click and carries the
// one-use launch marker into the same scheduled call.
assert.match(upcoming, /openAndArmCallLaunch/);
assert.match(upcoming, /qs\.set\("launch", "1"\)/);
assert.match(upcoming, /qs\.set\("upcoming"/);
assert.match(upcoming, /Add a supported Teams, Meet or Zoom link before starting/);

// Old prep links remain safe, but preparation itself now lives in /call.
assert.match(prep, /redirect\(`\/call/);
assert.match(prep, /Object\.entries\(searchParams \|\| \{\}\)/);
assert.doesNotMatch(prep, /openAndArmCallLaunch|\/api\/interview\/plan/);

// /call consumes and removes the one-use flag, then starts the session and bot.
// Manual starts open the provider directly before goLive.
assert.match(call, /consumeArmedCallLaunch\(upcoming, url\)/);
assert.match(call, /p\.delete\("launch"\)/);
assert.match(call, /window\.history\.replaceState/);
assert.match(call, /const openMeetingAndGoLive = useCallback/);
assert.match(call, /window\.open\(browserMeetingLaunchUrl\(url\), "_blank", "noopener,noreferrer"\)/);
assert.match(call, /openMeetingAndGoLive/);
assert.match(call, /Open meeting \+ start/);
assert.match(call, /autoLaunchHandledRef\.current = true/);
assert.match(call, /else openMeetingAndGoLive\(\)/);
assert.match(call, /setBotStartRequest\(\(request\) => request \+ 1\)/);

// Existing per-user and double-click guards remain in the cost-bearing path.
assert.match(meetStage, /sendingRef\.current/);
assert.match(meetStage, /botIdRef\.current/);
assert.match(startRoute, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(startRoute, /transcriber_already_active/);

// Exercise the real list click and real one-use marker for each user's own
// call, not just a source-text assertion. Opening must happen synchronously
// before navigation, and no AI prep or cost-bearing request runs in this list.
const require = createRequire(import.meta.url);
function compile(file, deps) {
  const module = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(name => name in deps ? deps[name] : require(name), module, module.exports);
  return module.exports;
}
const launchApi = compile("lib/call-launch.ts", {
  "@/lib/meeting-url": { validMeetingUrl },
  "@/lib/meeting-account": { browserMeetingLaunchUrl },
});
for (const [person, url] of [
  ["sharon", "https://teams.microsoft.com/l/meetup-join/sharon?context=%7B%22Tid%22%3A%22one%22%7D"],
  ["cam", "https://teams.live.com/meet/123456789?p=cam-meeting"],
  ["lee", "https://meet.google.com/abc-defg-hij"],
]) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://crm.test/crm/calls" });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  const events = [], reads = [];
  dom.window.open = (...args) => { events.push({ kind: "open", args }); return null; };
  const record = { id: `${person}-call`, owner_id: person, title: `${person} meeting`, meeting_url: url,
    scheduled_at: new Date(Date.now() + 60000).toISOString(), company: null, company_id: null, intent: null, prepped: false };
  const list = compile("components/crm/UpcomingCalls.tsx", {
    "next/navigation": { useRouter: () => ({ push: href => events.push({ kind: "navigate", href }) }) },
    "next/link": { default: props => React.createElement("a", props) },
    "@/lib/crm": {
      getCached: () => ({ calls: [record] }),
      crmFetch: async (url, options) => { reads.push({ url, options }); return { calls: [record] }; },
    },
    "@/lib/call-launch": launchApi,
    "@/lib/meeting-url": { validMeetingUrl },
    "@/lib/calendar-sync-client": {},
    "@/lib/calendar-create": { CALENDAR_DURATION_OPTIONS: [] },
    "@/components/crm/CompanyLinkPicker": { default: () => null },
    "@/components/VoiceNoteButton": { default: () => null },
  }).default;
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(list)));
    assert.equal(events.length, 0, "Viewing the list never opens or starts a call");
    const start = [...document.querySelectorAll("button")].find(button => button.textContent.includes("start call"));
    assert.ok(start, `${person} has the same Start call action`);
    await act(async () => start.click());
    assert.deepEqual(events.map(event => event.kind), ["open", "navigate"], "Meeting opens inside the click before LiveCoach navigation");
    assert.deepEqual(events[0].args, [browserMeetingLaunchUrl(url), "_blank", "noopener,noreferrer"]);
    const next = new URL(events[1].href, dom.window.location.origin);
    assert.equal(next.pathname, "/call");
    assert.equal(next.searchParams.get("upcoming"), record.id);
    assert.equal(next.searchParams.get("meetingUrl"), url);
    assert.equal(next.searchParams.get("launch"), "1");
    assert.equal(launchApi.consumeArmedCallLaunch(record.id, url), true);
    assert.equal(launchApi.consumeArmedCallLaunch(record.id, url), false, "Reload cannot consume the launch twice");
    assert.deepEqual(reads, [{ url: "/api/crm/upcoming", options: undefined }], "The list only reads the signed-in user's calendar feed");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
}
console.log("One-click Teams/Meet launch for Sharon, Cam and Lee, exact-call markers and single-start guards passed");
