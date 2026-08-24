import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const page = read("app/crm/inbox/page.tsx");
const lane = read("components/crm/OutreachTodayLane.tsx");
const nav = read("components/crm/NavMenu.tsx");
const queueRoute = read("app/api/crm/outreach/queue/route.ts");
const prepareRoute = read("app/api/crm/outreach/[id]/prepare/route.ts");

assert.match(page, /Sales <span className="italic text-amber">Today<\/span>/);
assert.match(page, /\{ key: "outreach", label: "Outreach" \}/);
assert.match(page, /dynamic\([\s\S]*OutreachTodayLane/);
assert.match(page, /filter === "outreach"[\s\S]*<OutreachTodayLane/);

assert.match(lane, /crmFetch<QueueResponse>\("\/api\/crm\/outreach\/queue"\)/);
assert.match(lane, /method: "POST"[\s\S]*body: "\{\}"/);
assert.match(lane, /`\/api\/crm\/outreach\/\$\{prospectId\}\/prepare`/);
assert.match(lane, /AI cost starts only when you press Prepare/);
assert.match(lane, /Every email still waits for exact review and approval/);
assert.match(lane, /The rest of the CRM remains usable/);
assert.match(lane, /contentVisibility: "auto"/);
assert.match(lane, /href="\/crm\/outreach\?tab=prospects"/);
assert.match(lane, /href="\/crm\/outreach\?tab=campaign"/);
assert.doesNotMatch(lane, /supabaseAdmin|\.from\("outreach_/);
assert.doesNotMatch(lane, /approve-all|messages\/\$\{.*\}\/approve/);

assert.match(nav, /const OUTREACH_ITEM/);
assert.match(
  nav,
  /salesHome\s*\?\s*\[homeItem, NOTIFICATIONS_ITEM, \.\.\.SHARED_CORE_ITEMS\]/
);
assert.match(nav, /label: "Campaigns and prospects"/);
assert.match(nav, /OUTREACH_ITEM,[\s\S]*\.\.\.SHARED_CORE_ITEMS/);

assert.match(queueRoute, /assigned_to_user_id === userId/);
assert.match(queueRoute, /reservedEmailsForAnotherCampaign/);
assert.match(queueRoute, /isInsideCrossCampaignCooldown/);
assert.match(prepareRoute, /Assign this prospect to yourself before preparing outreach/);

console.log("Sales Today consolidation checks passed");
