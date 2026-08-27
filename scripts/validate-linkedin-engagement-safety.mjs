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
assert.doesNotMatch(route, /web_search_20250305|needsPublicLookup/);
assert.match(route, /no longer opens or scrapes LinkedIn links/);
assert.match(route, /publicLinkLookup: false/);

assert.match(page, /Manual safe mode/);
assert.match(page, /No LinkedIn scraping\./);
assert.match(page, /only reads the words you paste/);
assert.match(page, /Messages, connection requests and this comment remain manual/);
assert.match(page, /A link on its own is deliberately rejected/);
assert.match(page, /signed-in salesperson's own saved voice/);

console.log("LinkedIn engagement safety checks passed");
