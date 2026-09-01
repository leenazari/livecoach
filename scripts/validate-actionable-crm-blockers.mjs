import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  crmBlockerPayload,
  crmFallbackBlockerPayload,
} from "../lib/crm-blocker.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const readTree = (directory) =>
  readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) return readTree(relative);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [read(relative)] : [];
    })
    .join("\n");

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

const fallbackCases = [
  {
    input: { status: 0, url: "/api/crm/outreach", method: "POST" },
    code: "crm_outreach_network",
    title: "Connection interrupted.",
    responsible: "user",
  },
  {
    input: {
      status: 400,
      url: "/api/crm/companies",
      method: "POST",
      serverMessage: "name is required",
    },
    code: "crm_company_400",
    title: "Company needs more information.",
    responsible: "user",
  },
  {
    input: { status: 401, url: "/api/crm/tasks", method: "PATCH" },
    code: "crm_task_401",
    title: "Sign-in required.",
    responsible: "user",
  },
  {
    input: {
      status: 403,
      url: "/api/crm/opportunities/1",
      method: "PATCH",
      serverMessage: "forbidden",
    },
    code: "crm_opportunity_403",
    title: "Access blocked.",
    responsible: "owner",
  },
  {
    input: {
      status: 404,
      url: "/api/crm/companies/1",
      method: "GET",
      serverMessage: "company not found",
    },
    code: "crm_company_404",
    title: "Company unavailable.",
    responsible: "owner",
  },
  {
    input: {
      status: 409,
      url: "/api/crm/outreach/1",
      method: "PATCH",
      serverMessage: "This prospect is assigned to another team member",
    },
    code: "crm_outreach_409",
    title: "Outreach action blocked.",
    responsible: "manager",
  },
  {
    input: { status: 413, url: "/api/crm/chat/1/uploads", method: "POST" },
    code: "crm_chat_413",
    title: "File too large.",
    responsible: "user",
  },
  {
    input: { status: 429, url: "/api/crm/assistant", method: "POST" },
    code: "crm_brain_429",
    title: "CRM temporarily limited.",
    responsible: "system",
  },
  {
    input: {
      status: 500,
      url: "/api/crm/tasks",
      method: "POST",
      serverMessage: "duplicate key violates database constraint",
    },
    code: "crm_task_500",
    title: "To-do action not confirmed.",
    responsible: "system",
  },
  {
    input: {
      status: 500,
      url: "/api/crm/notifications/1",
      method: "PATCH",
      serverMessage: "permission denied for table crm_notifications",
    },
    code: "crm_notification_500",
    title: "Notification action not confirmed.",
    responsible: "system",
  },
];

for (const test of fallbackCases) {
  const result = crmFallbackBlockerPayload(test.input);
  assert.equal(result.blocker.code, test.code);
  assert.equal(result.blocker.title, test.title);
  assert.equal(result.blocker.responsible, test.responsible);
  assert.ok(result.blocker.reason.length > 10);
  assert.ok(result.blocker.nextAction.length > 10);
}
assert.doesNotMatch(
  crmFallbackBlockerPayload(fallbackCases.at(-1).input).error,
  /permission denied|crm_notifications|for table/i,
  "Internal database detail must not be exposed in a fallback blocker"
);
assert.doesNotMatch(
  crmFallbackBlockerPayload(fallbackCases.at(-2).input).error,
  /duplicate key|database constraint/i,
  "Internal database detail must not be exposed in a fallback blocker"
);

const emailRoute = read("app/api/crm/assistant/email/route.ts");
const companyRoute = read("app/api/crm/companies/[id]/route.ts");
const assistant = read("components/crm/ClientAssistant.tsx");
const crmClient = read("lib/crm.ts");
const outreach = read("lib/outreach.ts");
const blockerAlert = read("components/crm/CrmBlockerAlert.tsx");
const rootLayout = read("app/layout.tsx");
const documentTray = read("components/crm/DocumentJobTray.tsx");
const documentPage = read("app/crm/documents/page.tsx");
const digestPage = read("app/crm/digest-test/page.tsx");
const tutorial = read("components/crm/SalesOutreachTutorial.tsx");
const liveCall = read("app/call/page.tsx");

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
assert.match(crmClient, /crmFallbackBlockerPayload/);
assert.match(crmClient, /data\?\.ok === false/);
assert.match(crmClient, /CRM_BLOCKER_EVENT/);
assert.match(crmClient, /notifyCrmRequestError/);
assert.match(crmClient, /export function crmConfirmationError/);
assert.match(crmClient, /status: 500/);
assert.match(crmClient, /status: 0/);
assert.doesNotMatch(assistant, /Could not save:/);
assert.match(assistant, /role="alert"/);
assert.match(assistant, /crmErrorFromResponse/);
assert.match(assistant, /crmConfirmationError/);

assert.match(blockerAlert, /Why it stopped/);
assert.match(blockerAlert, /What to do next/);
assert.match(blockerAlert, /RESPONSIBLE_LABEL/);
assert.match(blockerAlert, /Blocker code/);
assert.match(blockerAlert, /role="alert"/);
assert.match(rootLayout, /<CrmBlockerAlert \/>/);

for (const source of [documentTray, documentPage, digestPage, tutorial]) {
  assert.match(source, /crmFetch/);
  assert.doesNotMatch(source, /\bfetch\(/);
}
assert.match(liveCall, /crmFetch/);
assert.doesNotMatch(liveCall, /fetch\((?:"|`)\/api\/crm/);
assert.match(documentTray, /role="alert"/);
assert.match(documentPage, /role="alert"/);

// The only raw CRM browser requests left are the Brain streaming response and
// two deliberate fire-and-forget dashboard housekeeping jobs. The stream uses
// the same actionable response parser before showing an error.
const dashboard = read("app/crm/page.tsx");
assert.match(dashboard, /fetch\("\/api\/crm\/tasks\/sweep-stale"\)/);
assert.match(dashboard, /fetch\("\/api\/crm\/tasks\/fold-loose"\)/);
assert.equal(
  (assistant.match(/fetch\("\/api\/crm\//g) || []).length,
  1,
  "Only the Brain streaming request may bypass crmFetch"
);

const crmClientSources = [
  readTree("app/crm"),
  readTree("app/settings"),
  readTree("components/crm"),
  liveCall,
].join("\n");
assert.doesNotMatch(
  crmClientSources,
  /throw new Error\([^\n]*(?:database|server did not return|not confirmed|not saved)/i,
  "CRM response confirmation failures must use crmConfirmationError"
);

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
