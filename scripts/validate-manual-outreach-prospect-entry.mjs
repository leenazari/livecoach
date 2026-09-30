import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const route = read("app/api/crm/outreach/route.ts");
const page = read("app/crm/outreach/page.tsx");
const entry = read("components/crm/ManualProspectEntry.tsx");
const clients = read("app/crm/board/page.tsx");

assert.match(route, /loadRecentClientProspectCandidates/);
assert.match(route, /\.eq\("workspace_id", account\.workspaceId\)[\s\S]*?\.eq\("owner_id", account\.userId\)[\s\S]*?\.gte\("created_at", since\)/);
assert.match(route, /EMAIL_OUTREACH_CLIENT_STAGES/);
assert.match(route, /\.select\("id,name,stage,profile,created_at,updated_at"\)/);
assert.match(route, /EMAIL_OUTREACH_CLIENT_STAGES\.has\(stage\)/);
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
assert.match(route, /requestedContactId/);
assert.match(route, /"save_owned_client_outreach_contact_server"/);
assert.match(route, /p_actor_id: account\.userId/);
assert.match(route, /p_workspace_id: account\.workspaceId/);
assert.match(route, /result\.contact\.company_id !== requestedCompanyId/);
assert.match(route, /result\.prospect\.crm_company_id !== requestedCompanyId/);
assert.match(route, /MANUAL_PROSPECT_RPC_ERRORS/);
assert.match(route, /code: "manual_prospect_client_stage_blocked"/);
assert.match(route, /code: "manual_prospect_contact_email_conflict"/);

const postHandler = route.match(/export async function POST[\s\S]*$/)?.[0] || "";
assert.doesNotMatch(postHandler, /\.from\("outreach_(?:messages|enrolments|research_jobs)"\)\s*\.insert/);

assert.match(page, /setCrmCandidates\(data\.crmCandidates \|\| \[\]\)/);
assert.match(page, /<ManualProspectEntry/);
assert.match(entry, /A client is a company record\. An outreach prospect is a named person with an exact work email/);
assert.match(entry, /Recent clients not linked to email Outreach/);
assert.match(entry, /Work email not added/);
assert.match(entry, /Add work email/);
assert.match(entry, /Link to Outreach/);
assert.match(entry, /No named contact has been saved for this client yet/);
assert.match(entry, /crmContactId/);
assert.match(entry, /This saves or updates the person on the client and links the same record to your private Outreach list/);
assert.match(entry, /It does not research them, enrol them in a campaign, or send anything/);
assert.match(clients, /const createCompany = async \(input: NewClientInput\): Promise<boolean>/);
assert.match(clients, /"\/api\/crm\/clients\/complete"/);
assert.doesNotMatch(clients, /"\/api\/crm\/outreach"[\s\S]*?"\/api\/crm\/contacts"/);
assert.match(clients, /are now linked in Clients and Outreach/);
assert.match(clients, /Nothing was researched, enrolled, or sent/);
assert.match(clients, /Existing matching records were reused, so no duplicate was created/);

const promotionMigration = read(
  "supabase/migrations/20260930094015_atomic_owned_client_outreach_contact.sql"
);
assert.match(promotionMigration, /create or replace function public\.save_owned_client_outreach_contact_server/);
assert.match(promotionMigration, /security definer/);
assert.match(promotionMigration, /workspace_members[\s\S]*?wm\.status = 'active'/);
assert.match(promotionMigration, /c\.owner_id = p_actor_id/);
assert.match(promotionMigration, /ct\.owner_id = p_actor_id/);
assert.match(promotionMigration, /update public\.contacts[\s\S]*?email = email_value/);
assert.match(promotionMigration, /insert into public\.contacts/);
assert.match(promotionMigration, /insert into public\.outreach_prospects/);
assert.match(promotionMigration, /grant execute on function public\.save_owned_client_outreach_contact_server[\s\S]*?to service_role/);
assert.doesNotMatch(promotionMigration, /grant execute[\s\S]*?to authenticated/);

console.log("Manual Outreach prospect entry validation passed");
