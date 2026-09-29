import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const form = read("components/crm/ClientPortfolio.tsx");
const board = read("app/crm/board/page.tsx");
const contacts = read("app/api/crm/contacts/route.ts");
const outreach = read("app/api/crm/outreach/route.ts");
const completeRoute = read("app/api/crm/clients/complete/route.ts");
const atomicMigration = read(
  "supabase/migrations/20260929170440_atomic_complete_client_creation.sql"
);
const lockedRpcMigration = read(
  "supabase/migrations/20260929170754_lock_complete_client_rpc_to_server.sql"
);

assert.match(form, /export type NewClientInput = \{[\s\S]*?companyName: string;[\s\S]*?firstName: string;[\s\S]*?lastName: string;[\s\S]*?email: string;[\s\S]*?jobTitle: string;[\s\S]*?recordType: "prospect" \| "relationship";[\s\S]*?relationshipStage: string;/);
assert.match(form, /Company and primary contact/);
assert.match(form, /Contact first name/);
assert.match(form, /Exact work email/);
assert.match(form, /New sales prospect/);
assert.match(form, /Existing client or relationship/);
assert.match(form, /!newClient\.companyName\.trim\(\)[\s\S]*?!newClient\.firstName\.trim\(\)[\s\S]*?!newClient\.email\.trim\(\)/);
assert.match(form, /appear in Clients and the person will also appear in Outreach/);
assert.match(form, /Nothing is researched, enrolled, or sent automatically/);
assert.match(form, /appear in Clients only/);
assert.match(form, /not silently added to cold Outreach/);

const createFlow = board.match(/const createCompany = async \(input: NewClientInput\): Promise<boolean> => \{[\s\S]*?\n  \};\n  const deleteCompany/)?.[0] || "";
assert.ok(createFlow, "complete client creation flow is present");
assert.match(createFlow, /"\/api\/crm\/clients\/complete"/);
assert.doesNotMatch(createFlow, /"\/api\/crm\/companies"/);
assert.doesNotMatch(createFlow, /"\/api\/crm\/outreach"/);
assert.doesNotMatch(createFlow, /"\/api\/crm\/contacts"/);
assert.match(createFlow, /result\.prospect\.crm_company_id !== result\.company\.id/);
assert.match(createFlow, /result\.contact\.company_id !== result\.company\.id/);
assert.match(createFlow, /await load\("clients"\)/);
assert.match(createFlow, /Nothing was researched, enrolled, or sent/);
assert.match(createFlow, /They were not added to cold Outreach/);
assert.doesNotMatch(createFlow, /research_jobs|outreach_enrolments|outreach_messages|\/send/);

assert.match(completeRoute, /requireRequestScope\(\)/);
assert.match(completeRoute, /exactAccessibleCompany/);
assert.match(completeRoute, /loadSafeSharedCompanies/);
assert.match(completeRoute, /loadTeamLeadCoverCompanies/);
assert.match(completeRoute, /supabaseService\.rpc/);
assert.match(completeRoute, /"create_complete_crm_client_server"/);
assert.match(completeRoute, /p_actor_id: scope\.userId/);
assert.match(completeRoute, /p_workspace_id: scope\.workspaceId/);
assert.match(completeRoute, /result\.contact\.company_id !== result\.company\.id/);
assert.match(completeRoute, /result\.prospect\.crm_company_id !== result\.company\.id/);

assert.match(atomicMigration, /create or replace function public\.create_complete_crm_client/);
assert.match(atomicMigration, /security definer/);
assert.match(atomicMigration, /actor_id uuid := \(select auth\.uid\(\)\)/);
assert.match(atomicMigration, /workspace_members[\s\S]*?status = 'active'/);
assert.match(atomicMigration, /complete_client_company_access_blocked/);
assert.match(atomicMigration, /complete_client_prospect_owned_elsewhere/);
assert.match(atomicMigration, /complete_client_contact_owned_elsewhere/);
assert.match(atomicMigration, /insert into public\.companies/);
assert.match(atomicMigration, /insert into public\.contacts/);
assert.match(atomicMigration, /insert into public\.outreach_prospects/);
assert.match(atomicMigration, /set crm_company_id = company_row\.id/);
assert.match(atomicMigration, /revoke all on function public\.create_complete_crm_client[\s\S]*?from public, anon, authenticated/);
assert.match(lockedRpcMigration, /revoke all on function public\.create_complete_crm_client[\s\S]*?from public, anon, authenticated, service_role/);
assert.match(lockedRpcMigration, /create or replace function public\.create_complete_crm_client_server/);
assert.match(lockedRpcMigration, /p_actor_id uuid/);
assert.match(lockedRpcMigration, /workspace_members[\s\S]*?wm\.status = 'active'/);
assert.match(lockedRpcMigration, /set_config\('request\.jwt\.claim\.sub'/);
assert.match(lockedRpcMigration, /grant execute on function public\.create_complete_crm_client_server[\s\S]*?to service_role/);
assert.doesNotMatch(lockedRpcMigration, /grant execute[\s\S]*?to authenticated/);

assert.match(contacts, /\.from\("contacts"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)[\s\S]*?\.ilike\("email", exactIlikePattern\(email\)\)/);
assert.match(contacts, /code: "contact_email_owned_by_teammate"/);
assert.match(contacts, /alreadyExists: true/);

assert.match(outreach, /code: "manual_prospect_existing_company_mismatch"/);
assert.match(outreach, /code: "manual_prospect_existing_link_owner"/);
assert.match(outreach, /linkedExisting: true/);

console.log("Complete client entry validation passed");
