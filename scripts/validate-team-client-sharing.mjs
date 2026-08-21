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
const sharingHelper = read("lib/team-client-sharing.ts");
const companyRoute = read("app/api/crm/companies/[id]/route.ts");
const activityRoute = read("app/api/crm/companies/[id]/activity/route.ts");
const contextBuilder = read("lib/crm-context.ts");
const sharingApi = read("app/api/crm/team/sharing/route.ts");

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
assert.match(companyRoute, /shared_client_core_updated/);
assert.match(activityRoute, /sharedCompany/);
assert.match(activityRoute, /private history was not opened or changed/);
assert.match(contextBuilder, /ACCESS BOUNDARY/);
assert.match(contextBuilder, /loadSafeSharedCompan/);
assert.match(sharingApi, /requireWorkspaceOwner\(\)/);
assert.match(sharingApi, /sharedClientBlockReason/);

console.log("Team client sharing checks passed");
