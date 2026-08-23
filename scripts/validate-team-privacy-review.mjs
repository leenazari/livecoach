import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile("app/settings/team/privacy/page.tsx", "utf8");
const teamPage = await readFile("app/settings/team/page.tsx", "utf8");
const sharingApi = await readFile("app/api/crm/team/sharing/route.ts", "utf8");

assert.match(page, /crmFetch<SharingData>\("\/api\/crm\/team\/sharing"\)/);
assert.match(page, /Boolean\(record\.blockedReason\) && !record\.confidential/);
assert.match(page, /companyId: record\.id, confidential: true/);
assert.match(page, /result\.confidential !== true/);
assert.match(page, /result\.shared !== false/);
assert.match(page, /Every team member's Brain is blocked from it/);
assert.match(page, /Unlocking a confidential client never shares it/);
assert.match(teamPage, /href="\/settings\/team\/privacy"/);
assert.match(sharingApi, /requireWorkspaceOwner\(\)/);
assert.match(sharingApi, /Cache-Control": "private, no-store"/);

for (const privateSource of [
  "interview_sessions",
  "google_oauth",
  "microsoft_oauth",
  "email_context",
  ".transcript",
]) {
  assert.equal(
    page.includes(privateSource),
    false,
    `Privacy review must not query or render ${privateSource}`
  );
}

console.log("Team privacy review validation passed");
