import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260821232429_team_client_sharing.sql"
);
const ownerOnlyMigration = read(
  "supabase/migrations/20260821234128_restrict_team_client_sharing_to_owner.sql"
);
const assignmentMigration = read(
  "supabase/migrations/20260822084442_team_client_sales_ownership.sql"
);
const serviceBoundaryMigration = read(
  "supabase/migrations/20260822100306_team_client_assignment_service_boundary.sql"
);
const sharingHelper = read("lib/team-client-sharing.ts");
const companyRoute = read("app/api/crm/companies/[id]/route.ts");
const activityRoute = read("app/api/crm/companies/[id]/activity/route.ts");
const contextBuilder = read("lib/crm-context.ts");
const sharingApi = read("app/api/crm/team/sharing/route.ts");
const portfolioApi = read("app/api/crm/clients/portfolio/route.ts");
const portfolio = read("components/crm/ClientPortfolio.tsx");
const pipeline = read("components/crm/PipelineWorkspace.tsx");
const opportunityApi = read("app/api/crm/opportunities/[id]/route.ts");
const outreachApi = read("app/api/crm/outreach/[id]/route.ts");

assert.match(migration, /create table public\.team_client_shares/);
assert.match(migration, /alter table public\.team_client_shares enable row level security/);
assert.match(migration, /Members read active shared clients/);
assert.match(migration, /Owners share their private clients/);
assert.match(migration, /Owners change their client sharing/);
assert.match(ownerOnlyMigration, /wm\.role = 'owner'/);
assert.doesNotMatch(ownerOnlyMigration, /wm\.role in \('owner', 'manager'\)/);
assert.match(migration, /client_sales_access_shared/);
assert.match(migration, /client_sales_access_revoked/);
assert.doesNotMatch(
  migration,
  /create or replace function public\.(?:protect|audit)_team_client_share[\s\S]*?security definer/i,
  "Client sharing triggers must not bypass row security"
);

for (const column of [
  "assigned_to_user_id",
  "assigned_by_user_id",
  "assigned_at",
]) {
  assert.match(assignmentMigration, new RegExp(`\\b${column}\\b`));
}
assert.match(assignmentMigration, /team_client_shares_active_assignment_check/);
assert.match(assignmentMigration, /client_sales_assignment_changed/);
assert.match(assignmentMigration, /workspace_members/);
assert.match(assignmentMigration, /wm\.status = 'active'/);
assert.match(assignmentMigration, /set_team_client_sales_assignment/);
assert.match(assignmentMigration, /security invoker/i);
assert.match(
  assignmentMigration,
  /set_team_client_sales_assignment[\s\S]*?security definer[\s\S]*?auth\.uid\(\)[\s\S]*?wm\.role = 'owner'/i
);
assert.match(assignmentMigration, /Client and open revenue work assigned together/);
assert.match(assignmentMigration, /this private relationship type cannot be shared with sales/);
assert.match(assignmentMigration, /grant execute on function public\.set_team_client_sales_assignment/);
assert.match(serviceBoundaryMigration, /set_team_client_sales_assignment_service/);
assert.match(serviceBoundaryMigration, /security invoker/i);
assert.match(serviceBoundaryMigration, /p_actor_user_id/);
assert.match(serviceBoundaryMigration, /wm\.role = 'owner'/);
assert.match(serviceBoundaryMigration, /request\.jwt\.claim\.sub/);
assert.match(
  serviceBoundaryMigration,
  /revoke all on function public\.set_team_client_sales_assignment_service[\s\S]*?from public, anon, authenticated/i
);
assert.match(
  serviceBoundaryMigration,
  /grant execute on function public\.set_team_client_sales_assignment_service[\s\S]*?to service_role/i
);
for (const triggerFunction of [
  assignmentMigration.match(
    /create or replace function public\.validate_team_client_share_assignment\(\)[\s\S]*?\n\$\$;/i
  )?.[0] || "",
  assignmentMigration.match(
    /create or replace function public\.audit_team_client_share\(\)[\s\S]*?\n\$\$;/i
  )?.[0] || "",
]) {
  assert.doesNotMatch(
    triggerFunction,
    /security definer/i,
    "Client assignment triggers must not bypass row security"
  );
}

for (const sensitiveField of [
  "profile",
  "attributes",
  "notes",
  "email_context",
  "commercial_memory",
]) {
  assert.doesNotMatch(
    sharingHelper.match(/SAFE_SHARED_COMPANY_SELECT\s*=\s*([\s\S]*?);/)?.[1] || "",
    new RegExp(`\\b${sensitiveField}\\b`),
    `${sensitiveField} must not be selected for the shared sales projection`
  );
}

assert.match(sharingHelper, /Investor records stay private/);
assert.match(sharingHelper, /Internal and staff records stay private/);
assert.match(sharingHelper, /Board and adviser records stay private/);
assert.match(sharingHelper, /Vendors and product trials stay private/);
assert.match(companyRoute, /mode: sharedSalesAccess \? "shared_sales" : "owner"/);
assert.match(companyRoute, /privateSourcesHidden: sharedSalesAccess/);
assert.match(companyRoute, /belongs to another salesperson and is view only/);
assert.match(companyRoute, /shared_client_core_updated/);
assert.match(activityRoute, /sharedCompany/);
assert.match(activityRoute, /private history was not opened or changed/);
assert.match(contextBuilder, /ACCESS BOUNDARY/);
assert.match(contextBuilder, /loadSafeSharedCompan/);
assert.match(sharingApi, /requireWorkspaceOwner\(\)/);
assert.match(sharingApi, /sharedClientBlockReason/);
assert.match(sharingApi, /Choose the salesperson responsible for this client/);
assert.match(sharingApi, /set_team_client_sales_assignment_service/);
assert.match(sharingApi, /supabaseService\.rpc/);
assert.match(sharingApi, /A failure cannot leave either half saved/);
assert.match(portfolioApi, /assignedToUserId/);
assert.match(portfolioApi, /canManageAssignments/);
assert.match(portfolio, /My work/);
assert.match(portfolio, /Sales owner/);
assert.match(pipeline, /My work/);
assert.match(pipeline, /belongs to another salesperson/);
assert.match(opportunityApi, /belongs to another salesperson and is view only/);
assert.match(outreachApi, /belongs to another salesperson and is view only/);

console.log("Team client sharing checks passed");
