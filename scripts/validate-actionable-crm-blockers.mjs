import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crmBlockerPayload } from "../lib/crm-blocker.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const example = crmBlockerPayload({
  code: "outreach_assigned_to_another_salesperson",
  title: "Email blocked",
  reason: "This lead is assigned to another salesperson",
  nextAction: "Ask a manager to reassign the lead before sending",
  responsible: "manager",
});

assert.equal(
  example.error,
  "Email blocked. This lead is assigned to another salesperson. Ask a manager to reassign the lead before sending."
);
assert.deepEqual(example.blocker, {
  code: "outreach_assigned_to_another_salesperson",
  title: "Email blocked.",
  reason: "This lead is assigned to another salesperson.",
  nextAction: "Ask a manager to reassign the lead before sending.",
  responsible: "manager",
});

const emailRoute = read("app/api/crm/assistant/email/route.ts");
const companyRoute = read("app/api/crm/companies/[id]/route.ts");
const assistant = read("components/crm/ClientAssistant.tsx");
const crmClient = read("lib/crm.ts");
const outreach = read("lib/outreach.ts");

for (const code of [
  "outreach_recipient_email_missing",
  "outreach_do_not_contact",
  "outreach_assigned_to_another_salesperson",
  "outreach_crm_relationship_ineligible",
  "outreach_paused_campaign_enrolment",
  "outreach_cross_campaign_cooldown",
  "outreach_claimed_during_approval",
  "outreach_queue_confirmation_failed",
]) {
  assert.match(emailRoute, new RegExp(`["']${code}["']`));
}
assert.match(emailRoute, /const blockedResponse/);
assert.match(emailRoute, /reason:/);
assert.match(emailRoute, /nextAction:/);
assert.match(emailRoute, /responsible:/);
assert.doesNotMatch(
  emailRoute,
  /This CRM relationship is not eligible for cold outreach/
);
assert.doesNotMatch(
  emailRoute,
  /pause that campaign before sending it separately/i
);

for (const code of [
  "company_unavailable",
  "company_access_not_confirmed",
  "company_edit_access_missing",
  "company_assigned_to_another_salesperson",
  "company_update_not_confirmed",
  "company_delete_not_confirmed",
]) {
  assert.match(companyRoute, new RegExp(`code: ["']${code}["']`));
}
assert.match(companyRoute, /crmBlockerPayload/);
assert.match(companyRoute, /nextAction:/);

assert.match(crmClient, /export class CrmRequestError extends Error/);
assert.match(crmClient, /blocker: CrmRequestBlocker \| null/);
assert.match(crmClient, /data\?\.blocker/);
assert.doesNotMatch(assistant, /Could not save:/);
assert.match(assistant, /role="alert"/);

const sharedLoader =
  outreach.match(
    /async function loadAssignedSharedCompaniesForOutreach\(\)[\s\S]*?\n}/
  )?.[0] || "";
assert.match(sharedLoader, /getRequestScope\(\)/);
assert.match(sharedLoader, /isVerifiedServiceRequest\(\)/);
assert.match(sharedLoader, /getServiceRecordScope\(\)/);
assert.match(sharedLoader, /\.from\("team_client_shares"\)/);
assert.match(sharedLoader, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(
  sharedLoader,
  /\.eq\("assigned_to_user_id", scope\.userId\)/
);
assert.match(sharedLoader, /\.eq\("status", "active"\)/);
assert.match(sharedLoader, /loadSafeSharedCompanies/);
for (const privateField of [
  "notes",
  "email_context",
  "commercial_memory",
]) {
  assert.doesNotMatch(
    sharedLoader.replace(/\/\/[^\n]*/g, ""),
    new RegExp(`\\b${privateField}\\b`),
    `${privateField} must not be loaded into the outreach eligibility guard`
  );
}

console.log("Actionable CRM blocker checks passed");
