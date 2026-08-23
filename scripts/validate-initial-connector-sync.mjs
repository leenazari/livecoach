import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const googleCallback = read("app/api/auth/google/callback/route.ts");
const microsoftCallback = read("app/api/auth/microsoft/callback/route.ts");
const initialSync = read("components/InitialCalendarSync.tsx");
const settings = read("app/settings/page.tsx");
const joinTeam = read("app/join-team/page.tsx");

assert.match(googleCallback, /google=connected&calendar=sync/);
assert.match(microsoftCallback, /value === "connected" \? "&calendar=sync"/);
assert.match(initialSync, /params\.get\("calendar"\) !== "sync"/);
assert.match(initialSync, /cleanUrl\.searchParams\.delete\("calendar"\)/);
assert.match(initialSync, /"\/api\/crm\/calendar-sync"/);
assert.match(initialSync, /method: "POST"/);
assert.match(initialSync, /Connection saved\. Syncing your calendar for the first time/);
assert.match(settings, /<InitialCalendarSync \/>/);
assert.match(joinTeam, /<InitialCalendarSync enabled=\{status\?\.crmAccess === true\} \/>/);

console.log("Initial connector calendar sync checks passed");
