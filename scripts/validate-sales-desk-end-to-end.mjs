import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const page = read("app/crm/inbox/page.tsx");
const lane = read("components/crm/OutreachTodayLane.tsx");
const nav = read("components/crm/NavMenu.tsx");
const home = read("app/page.tsx");
const login = read("app/login/page.tsx");
const join = read("app/join-team/page.tsx");
const middleware = read("middleware.ts");
const queue = read("app/api/crm/outreach/queue/route.ts");

// The role-aware Sales Desk is the default entry point and the full outreach
// journey is visible without opening the legacy outreach workspace.
assert.match(home, /redirect\("\/crm"\)/);
assert.match(login, /router\.push\("\/crm"\)/);
assert.match(join, /router\.push\("\/crm"\)/);
assert.match(middleware, /membership\.role !== "owner"[\s\S]*url\.pathname = "\/crm\/inbox"/);
assert.match(page, /useState<Filter>\("outreach"\)/);
assert.match(page, /Sales <span className="italic text-amber">Desk<\/span>/);
assert.match(page, /aria-label="End to end sales flow"/);
assert.match(page, /Calls and actions that cannot wait/);

// The next 20 retain exact-draft approval and the existing spaced send queue.
assert.match(lane, /useState\(20\)/);
assert.match(lane, /Next \{dailyLimit\} leads/);
assert.match(lane, /`\/api\/crm\/outreach\/\$\{prospectId\}\/prepare`/);
assert.match(lane, /status: "approved"/);
assert.match(lane, /`\/api\/crm\/outreach\/messages\/\$\{message\.id\}\/send`/);
assert.match(lane, /Sent contacts rotate to the bottom automatically/);
assert.match(queue, /assigned_to_user_id === userId/);

// Salespeople see only the working destinations. Secondary tools still exist
// under More, while owners retain their broader navigation.
assert.match(nav, /const SALES_CORE_ITEMS: Item\[\] = \[PIPELINE_ITEM, CLIENTS_ITEM\]/);
assert.match(nav, /\[homeItem, \.\.\.SALES_CORE_ITEMS, NOTIFICATIONS_ITEM\]/);
assert.match(nav, /CAMPAIGNS_ITEM, CALLS_ITEM, PLAYBOOK_ITEM, DOCUMENTS_ITEM, COSTS_ITEM/);
assert.match(nav, /\.\.\.OWNER_CORE_ITEMS/);

console.log("Sales Desk end to end checks passed");
