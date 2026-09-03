import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  crmCallHref,
  crmCompanyHref,
  outreachProspectHref,
  outreachReplyHref,
} from "../lib/crm-navigation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

assert.equal(crmCompanyHref("company-1"), "/crm/company-1");
assert.equal(crmCallHref("call 1"), "/crm/calls/call%201");
assert.equal(
  outreachProspectHref({ id: "prospect-1", crm_company_id: "company-1" }),
  "/crm/outreach?tab=prospects&prospect=prospect-1",
  "a prospect must open even when its linked client is private to another user"
);
assert.equal(
  outreachProspectHref({ id: "prospect 1" }),
  "/crm/outreach?tab=prospects&prospect=prospect%201",
  "an outreach-only person must still have an exact destination"
);
assert.equal(
  outreachProspectHref({ crm_company_id: "company-1" }),
  "/crm/company-1",
  "legacy activity without a prospect ID can still fall back to its client"
);
assert.equal(outreachProspectHref(null), null);
assert.equal(
  outreachReplyHref("prospect 1"),
  "/crm/outreach?tab=replies&reply=prospect%201"
);
assert.equal(outreachReplyHref(null), null);

const outreachPage = source("app/crm/outreach/page.tsx");
assert.match(outreachPage, /Opened from linked activity/);
assert.match(outreachPage, /openProspectFromThisPage\(message\.prospect, event\)/);
assert.match(outreachPage, /openProspectFromThisPage\(call\.prospect, event\)/);
assert.match(outreachPage, /openProspectFromThisPage\(reply, event\)/);
assert.match(outreachPage, /if \(!prospect\?\.id\) return;/);
assert.match(outreachPage, /stopPropagation className="block min-h-11/);

const metricsRoute = source("app/api/crm/outreach/metrics/route.ts");
assert.match(
  metricsRoute,
  /last_reply_at,reply_category,crm_company_id/,
  "activity rows need the canonical CRM company ID"
);

const callsPage = source("app/crm/calls/page.tsx");
assert.match(callsPage, /CanonicalRecordLink href=\{href\}/);
assert.match(callsPage, /CanonicalRecordLink href=\{crmCompanyHref\(c\.company_id\)\}/);

const notificationPage = source("app/crm/notifications/page.tsx");
assert.match(notificationPage, /aria-label=\{`Open \$\{notification\.title\} in CRM`\}/);

console.log("canonical entity navigation validation passed");
