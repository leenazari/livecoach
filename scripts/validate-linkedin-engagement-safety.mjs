import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const route = read("app/api/crm/outreach/engage/route.ts");
const page = read("app/crm/outreach/page.tsx");

assert.match(route, /requireRequestScope\(\)/);
assert.match(route, /getSalesProfile\(scope\)/);
assert.match(route, /select\("display_name"\)/);
assert.match(route, /salesProfile\.roleTitle/);
assert.match(route, /salesProfile\.emailTone/);
assert.doesNotMatch(route, /for Lee Nazari, CEO of Interviewa/);
assert.doesNotMatch(route, /Lee's work/);
assert.doesNotMatch(route, /Building Interviewa has reinforced/);
assert.match(route, /Never present this person as Lee/);

assert.match(page, /Manual safe mode/);
assert.match(page, /No LinkedIn account connection/);
assert.match(page, /never signs into, scrapes through or posts from your LinkedIn account/);
assert.match(page, /signed-in salesperson's own saved voice/);

console.log("LinkedIn engagement safety checks passed");
