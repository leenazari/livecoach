import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  normaliseOutreachImportRows,
  parseCsvRows,
} from "../lib/outreach-import.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const parsed = parseCsvRows(
  'Email,First Name,Last Name,Company,Status,Role\n"PAT@example.com",Pat,Smith,"Example, Ltd",not contacted,Director\nlee@example.com,Lee,Jones,Acme,dead,Founder'
);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].Company, "Example, Ltd");

const normalised = normaliseOutreachImportRows(
  [
    ...parsed,
    { Email: "pat@example.com", Company: "Example, Ltd" },
    { Email: "crm@example.com", Company: "CRM Ltd" },
    { Email: "missing-company@example.com" },
    { Email: "not-an-email", Company: "Bad Ltd" },
  ],
  new Set(["existing@example.com"]),
  new Set(["crm@example.com"])
);
assert.equal(normalised[0].email, "pat@example.com");
assert.equal(normalised[0].decision, "ready");
assert.equal(normalised[0].importStatus, "imported");
assert.equal(normalised[1].importStatus, "not_interested");
assert.equal(normalised[2].decision, "duplicate");
assert.equal(normalised[3].decision, "duplicate");
assert.equal(normalised[4].decision, "review");
assert.equal(normalised[5].decision, "invalid");

const importMigration = read("supabase/migrations/20260903000658_staged_outreach_imports.sql");
assert.match(importMigration, /enable row level security/i);
assert.match(importMigration, /wm\.role = 'owner'/);
assert.match(importMigration, /grant execute on function public\.apply_outreach_import_batch_service[\s\S]*to service_role/);
assert.match(importMigration, /on conflict do nothing/);
assert.match(importMigration, /interval '10 minutes'/);
assert.match(importMigration, /not exists \(select 1 from public\.outreach_messages/);

const stageRoute = read("app/api/crm/imports/outreach/stage/route.ts");
assert.match(stageRoute, /requireWorkspaceOwner/);
assert.match(stageRoute, /normaliseOutreachImportRows/);
assert.match(stageRoute, /workspaceEmailSet\("contacts"/);
assert.match(stageRoute, /body\.rows\.length > 500/);

const contactRoute = read("app/api/crm/contacts/[id]/route.ts");
assert.match(contactRoute, /current\.owner_id !== scope\.userId/);
assert.match(contactRoute, /loadAssignedClientAccess\(companyId, scope\)/);
assert.match(contactRoute, /contact_company_exact_email_duplicate/);
assert.match(contactRoute, /patch\.department_id = null/);

const authority = read("lib/brain-authority.ts");
assert.match(authority, /stage_outreach_import:[\s\S]*ownerOnly: true/);
assert.match(authority, /link_contact_to_client/);
assert.match(authority, /merge_duplicate_clients:[\s\S]*ownerOnly: true/);

const controlPage = read("app/crm/brain-control/page.tsx");
assert.match(controlPage, /role === "owner"/);
assert.match(controlPage, /Staff can use their approved day-to-day actions but cannot change Brain authority, application code or workspace permissions/);

const postCall = read("app/api/crm/update-profile/route.ts");
assert.match(postCall, /post_call_package: completionPackage/);
assert.match(postCall, /validCommitmentDueAt/);
assert.match(postCall, /Never invent a deadline/);
assert.match(postCall, /\.eq\("owner_id", scope\.userId\)/);

const callRoute = read("app/api/crm/calls/[id]/route.ts");
assert.match(callRoute, /requireRequestScope/);
assert.match(callRoute, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(callRoute, /\.eq\("owner_id", scope\.userId\)/);

const completionPage = read("app/crm/calls/[id]/page.tsx");
assert.match(completionPage, /PostCallCompletionPackage/);
assert.doesNotMatch(completionPage, /<PostCallDealUpdate/);

console.log("Brain workflow completion validation passed");
