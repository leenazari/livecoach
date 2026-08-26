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

assert.match(page, /Sales <span className="italic text-amber">Desk<\/span>/);
assert.match(page, /useState<Filter>\("outreach"\)/);
assert.match(page, /\{ key: "outreach", label: "Sales flow" \}/);
assert.match(page, /dynamic\([\s\S]*OutreachTodayLane/);
assert.match(page, /filter === "outreach"[\s\S]*<OutreachTodayLane/);
assert.match(page, /Calls and actions that cannot wait/);
assert.match(page, /attentionItems\.map/);

assert.match(lane, /crmFetch<QueueResponse>\("\/api\/crm\/outreach\/queue"\)/);
assert.match(lane, /method: "POST"[\s\S]*body: "\{\}"/);
assert.match(lane, /`\/api\/crm\/outreach\/\$\{prospectId\}\/prepare`/);
assert.match(lane, /const \[visible, setVisible\] = useState\(20\)/);
assert.match(lane, /Next \{dailyLimit\} leads/);
assert.match(lane, /Prepare, review, approve and queue each email here/);
assert.match(lane, /Advanced outreach tools/);
assert.match(lane, /The rest of the CRM remains usable/);
assert.match(lane, /contentVisibility: "auto"/);
assert.match(lane, /href="\/crm\/outreach\?tab=prospects"/);
assert.match(lane, /href="\/crm\/outreach\?tab=campaign"/);
assert.doesNotMatch(lane, /supabaseAdmin|\.from\("outreach_/);
assert.doesNotMatch(lane, /approve-all|messages\/\$\{.*\}\/approve/);

assert.match(nav, /const OUTREACH_ITEM/);
assert.match(
  nav,
  /salesHome\s*\?\s*\[homeItem, \.\.\.SALES_CORE_ITEMS, NOTIFICATIONS_ITEM\]/
);
assert.match(nav, /const SALES_OUTREACH_ITEM: Item = \{[\s\S]*?href: "\/crm\/outreach\?tab=prospects"/);
assert.match(nav, /const SALES_CORE_ITEMS: Item\[\] = \[[\s\S]*?SALES_OUTREACH_ITEM/);
assert.match(nav, /salesHome\s*\? SALES_OUTREACH_ITEM\s*: OUTREACH_ITEM/);
assert.doesNotMatch(nav, /CAMPAIGNS_ITEM/);

assert.match(queueRoute, /assigned_to_user_id === userId/);
assert.match(queueRoute, /reservedEmailsForAnotherCampaign/);
assert.match(queueRoute, /isInsideCrossCampaignCooldown/);
assert.match(prepareRoute, /Assign this prospect to yourself before preparing outreach/);

console.log("Sales Today consolidation checks passed");
