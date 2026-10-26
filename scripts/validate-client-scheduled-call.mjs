import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { clientScheduledCalls } from "../lib/client-scheduled-call.ts";

const now = Date.parse("2026-10-26T10:00:00Z");
const eventA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const make = (minutes, id = eventA) => ({ type: "meeting", at: new Date(now + minutes * 60000).toISOString(), title: "Client meeting", href: `/call?upcoming=${id}` });
assert.equal(clientScheduledCalls([make(-20)], now).preferred.href, `/call?upcoming=${eventA}`, "A call already underway opens its booked room");
assert.equal(clientScheduledCalls([make(1)], now).current.length, 1, "The one-minute lobby window is reachable");
assert.equal(clientScheduledCalls([make(30), make(15, eventB)], now).preferred.href, `/call?upcoming=${eventB}`);
assert.equal(clientScheduledCalls([make(-15), make(-10, eventB)], now).preferred, null, "Overlapping meetings need an explicit choice");
assert.equal(clientScheduledCalls([make(-181)], now).preferred, null, "Do not reopen an old uncompleted meeting by accident");
assert.equal(clientScheduledCalls([{ ...make(0), href: "/call?company=another-client" }], now).preferred, null);
assert.equal(clientScheduledCalls([{ ...make(0), href: "https://untrusted.example/call" }], now).preferred, null);
assert.equal(clientScheduledCalls([{ ...make(0), type: "call" }], now).preferred, null, "Historical summaries are not live workspaces");
assert.equal(clientScheduledCalls([], now).preferred, null);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const timeline = read("app/api/crm/companies/[id]/timeline/route.ts");
assert.match(timeline, /\.from\("upcoming_calls"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)[\s\S]*?\.eq\("owner_id", scope\.userId\)[\s\S]*?\.eq\("company_id", params\.id\)/);
assert.match(timeline, /new Date\(now - 3 \* 3600000\)/);
assert.match(read("app/crm/[id]/page.tsx"), /href=\{bookedCalls\.preferred\?\.href/);

// Render the real list so link labels, targets and checkbox styling are checked
// together. No network calls or cost-bearing launch actions run during render.
const require = createRequire(import.meta.url);
const fixtureCalls = [-10, 60].map((minutes, index) => ({
  id: index ? eventB : eventA, company_id: null, company: null,
  title: index ? "Next meeting" : "Meeting in progress",
  scheduled_at: new Date(Date.now() + minutes * 60000).toISOString(),
  meeting_url: "https://meet.google.com/abc-defg-hij", intent: null, prepped: !index,
}));
const module = { exports: {} };
const compiled = ts.transpileModule(read("components/crm/UpcomingCalls.tsx"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "next/navigation") return { useRouter: () => ({}) };
  if (name === "next/link") return { default: (props) => React.createElement("a", props) };
  if (name === "@/lib/crm") return { getCached: () => ({ calls: fixtureCalls }) };
  if (name.startsWith("@/components/")) return { default: () => null };
  if (name.startsWith("@/lib/")) return {};
  return require(name);
}, module, module.exports);
const doc = new JSDOM(renderToStaticMarkup(React.createElement(module.exports.default))).window.document;
const links = [...doc.querySelectorAll("a")];
const open = links.find((link) => link.textContent === "open call ▸");
assert.equal(new URL(open.href, "https://crm.test").searchParams.get("upcoming"), eventA);
assert.match(open.title, /existing notetaker/);
assert.equal(links.filter((link) => link.textContent === "prep ▸").length, 1);
const prepped = doc.querySelector('[aria-label="toggle prepped"]');
assert.match(prepped.className, /border-sky bg-sky text-ink/);
assert.doesNotMatch(prepped.className, /scheduled call|notetaker/);
console.log("Client entry uses the exact booked call, keeps in-progress calls visible and requires a choice for ambiguous meetings");
