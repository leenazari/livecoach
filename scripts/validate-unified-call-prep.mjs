import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const prepRedirect = read("app/crm/prep/page.tsx");
const callPage = read("app/call/page.tsx");
const upcoming = read("components/crm/UpcomingCalls.tsx");
const routeSurfaces = [
  "app/api/cron/daily-digest/route.ts",
  "app/api/crm/companies/[id]/timeline/route.ts",
  "app/api/crm/dashboard/route.ts",
  "app/api/crm/inbox/route.ts",
  "app/crm/[id]/page.tsx",
  "lib/crm-context.ts",
].map(read).join("\n");

assert.match(prepRedirect, /import \{ redirect \} from "next\/navigation"/);
assert.match(prepRedirect, /Object\.entries\(searchParams \|\| \{\}\)/);
assert.match(prepRedirect, /query\.append\(key, item\)/);
assert.match(prepRedirect, /redirect\(`\/call/);
assert.doesNotMatch(prepRedirect, /"use client"|\/api\/interview\/plan/);

assert.match(upcoming, /<Link\s+href=\{callHref\(c\)\}/);
assert.doesNotMatch(
  upcoming,
  /href=\{callHref\(c\)\}[\s\S]{0,260}target="_blank"/
);
assert.doesNotMatch(routeSurfaces, /\/crm\/prep\?/);
assert.match(routeSurfaces, /\/call\?upcoming=/);

for (const control of [
  /Research page/,
  /Research person/,
  /personStage === "confirm"/,
  /Build focus/,
  /Build plan from this focus/,
  /Open meeting \+ start/,
  /Complete without bot/,
]) {
  assert.match(callPage, control);
}

const firstMeetingStart = callPage.indexOf("FIRST-MEETING INTENT HELP");
const firstMeetingEnd = callPage.indexOf("// Auto-save the prep plan", firstMeetingStart);
assert.ok(firstMeetingStart >= 0 && firstMeetingEnd > firstMeetingStart);
const firstMeetingFlow = callPage.slice(firstMeetingStart, firstMeetingEnd);
assert.match(firstMeetingFlow, /\/api\/interview\/first-meeting-intent/);
assert.doesNotMatch(firstMeetingFlow, /fetch\("\/api\/interview\/research"/);

console.log("Unified call preparation checks passed");
