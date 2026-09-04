import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260904105146_assign_outreach_company_access.sql"
);
const assignmentService = read("lib/outreach-assignment-service.ts");
const outreachGuard = read("lib/outreach.ts");
const blocker = read("lib/outreach-crm-blocker.ts");
const bulkAssignmentRoute = read("app/api/crm/outreach/assign/route.ts");
const prospectRoute = read("app/api/crm/outreach/[id]/route.ts");
const queueRoute = read("app/api/crm/outreach/queue/route.ts");
const outreachRoute = read("app/api/crm/outreach/route.ts");

assert.match(
  migration,
  /assign_outreach_prospects_with_company_access_service/
);
assert.match(migration, /language plpgsql[\s\S]*security invoker/i);
assert.doesNotMatch(migration, /security definer/i);
assert.match(migration, /wm\.workspace_id = p_workspace_id/);
assert.match(migration, /wm\.user_id = p_actor_user_id/);
assert.match(migration, /wm\.user_id = p_assigned_to_user_id/);
assert.match(migration, /for update/);
assert.match(migration, /prospect\.visibility = 'team'/);
assert.match(migration, /company\.workspace_id = prospect\.workspace_id/);
assert.match(migration, /company_record\.is_confidential/);
assert.match(
  migration,
  /lower\(trim\(coalesce\(company_record\.stage, ''\)\)\) <> 'new'/
);
assert.match(migration, /opportunity\.status = 'open'/);
assert.match(migration, /assigned_to_user_id = excluded\.assigned_to_user_id/);
assert.match(migration, /perform set_config\('request\.jwt\.claim\.sub'/);
assert.match(
  migration,
  /revoke all on function public\.assign_outreach_prospects_with_company_access_service[\s\S]*from public, anon, authenticated/i
);
assert.match(
  migration,
  /grant execute on function public\.assign_outreach_prospects_with_company_access_service[\s\S]*to service_role/i
);
for (const privateField of [
  "email_context",
  "commercial_memory",
  "notes",
  "interview_sessions",
  "meet_utterances",
]) {
  assert.doesNotMatch(
    migration,
    new RegExp(`insert\\s+into\\s+public\\.${privateField}`, "i")
  );
}

assert.match(
  assignmentService,
  /assign_outreach_prospects_with_company_access_service/
);
assert.match(assignmentService, /p_actor_user_id: input\.actorUserId/);
assert.match(assignmentService, /p_workspace_id: input\.workspaceId/);
assert.match(assignmentService, /p_assigned_to_user_id: input\.assignedToUserId/);
assert.match(assignmentService, /did not confirm the complete outreach assignment/);

assert.match(outreachGuard, /prospectCompanyIds/);
assert.match(outreachGuard, /loadSafeSharedCompanies/);
assert.match(outreachGuard, /scope\.workspaceId/);
assert.match(outreachGuard, /slice\(0, 1000\)/);

for (const route of [bulkAssignmentRoute, prospectRoute, queueRoute]) {
  assert.match(route, /assignOutreachProspectsWithCompanyAccess/);
  assert.match(route, /workspaceId: account\.workspaceId/);
}
assert.match(queueRoute, /outreachCrmBlocker/);
assert.match(queueRoute, /prospectCompanyIds/);
assert.match(outreachRoute, /prospectCompanyIds/);

assert.match(blocker, /outreach_company_access_required/);
assert.match(blocker, /outreach_existing_relationship_protected/);
assert.match(blocker, /outreach_company_domain_protected/);
assert.match(blocker, /responsible: "owner"/);

console.log("Outreach assignment company-access checks passed");
