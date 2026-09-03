import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const route = read("app/api/crm/outreach/route.ts");
const page = read("app/crm/outreach/page.tsx");
const entry = read("components/crm/ManualProspectEntry.tsx");
const clients = read("app/crm/board/page.tsx");

assert.match(route, /loadRecentClientProspectCandidates/);
assert.match(route, /\.eq\("workspace_id", account\.workspaceId\)[\s\S]*?\.eq\("owner_id", account\.userId\)[\s\S]*?\.gte\("created_at", since\)/);
assert.match(route, /linkedCompanyIds\.has\(company\.id\)/);
assert.match(route, /\.from\("outreach_prospects"\)[\s\S]*?\.eq\("workspace_id", account\.workspaceId\)[\s\S]*?\.ilike\("email", exactIlikePattern\(email\)\)/);
assert.match(route, /code: "manual_prospect_owned_by_teammate"/);
assert.match(route, /code: "manual_prospect_known_relationship_owner"/);
assert.match(route, /code: "manual_prospect_contact_company_mismatch"/);
assert.match(route, /code: "manual_prospect_client_ambiguous"/);
assert.match(route, /\.ilike\("name", exactIlikePattern\(companyName\)\)/);
assert.match(route, /loadAssignedClientAccess\(crmCompanyId, account\)/);
assert.match(route, /\.insert\(\{[\s\S]*?\.\.\.privateRecordFields\(account\)[\s\S]*?assigned_to_user_id: account\.userId/);
assert.match(route, /source_file: "LiveCoach manual entry"/);
assert.match(route, /noOutreachSent: true/);

const postHandler = route.match(/export async function POST[\s\S]*$/)?.[0] || "";
assert.doesNotMatch(postHandler, /\.from\("outreach_(?:messages|enrolments|research_jobs)"\)\s*\.insert/);

assert.match(page, /setCrmCandidates\(data\.crmCandidates \|\| \[\]\)/);
assert.match(page, /<ManualProspectEntry/);
assert.match(entry, /A client is a company record\. An outreach prospect is a named person with an exact work email/);
assert.match(entry, /Recent clients waiting for a person/);
assert.match(entry, /This creates a private prospect assigned to you/);
assert.match(entry, /It does not research the person, enrol them in a campaign, or send anything/);
assert.match(clients, /was saved under Clients\. To add a person to Outreach/);
assert.match(clients, /already existed under Clients\. No duplicate was created/);

console.log("Manual Outreach prospect entry validation passed");
