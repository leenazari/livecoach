import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const route = read("app/api/crm/outreach/messages/[id]/rehearse/route.ts");
const page = read("app/crm/outreach/page.tsx");

assert.match(route, /message\.sender_user_id !== sender\.userId/);
assert.match(route, /to: sender\.mailboxEmail/);
assert.match(route, /provider: sender\.provider/);
assert.match(route, /accepted: true/);
assert.match(route, /deliveryLocation/);
assert.match(route, /outreach_rehearsal_accepted/);
assert.match(route, /campaignChanged: false/);
assert.match(page, /!result\.accepted/);
assert.match(page, /Gmail accepted the rehearsal/);
assert.match(page, /look in Sent or All Mail/);
assert.match(page, /may not create a new Inbox message/);
assert.match(page, /No prospect was contacted and campaign results did not change/);

console.log("Outreach rehearsal delivery receipt validation passed.");
