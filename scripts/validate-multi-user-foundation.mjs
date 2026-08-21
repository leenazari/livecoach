import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821095420_multi_user_security_foundation.sql"
  ),
  "utf8"
);
const apiIsolationMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821130021_multi_user_api_isolation.sql"
  ),
  "utf8"
);
const keyCleanupMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821130536_remove_global_single_user_keys.sql"
  ),
  "utf8"
);
const rpcHardeningMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821130400_harden_multi_user_rpcs.sql"
  ),
  "utf8"
);
const costRollupGrantMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821130430_grant_scoped_cost_rollup.sql"
  ),
  "utf8"
);
const legacyStorageMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821130450_bind_legacy_storage_owner.sql"
  ),
  "utf8"
);
const signalScopeMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821130470_scope_opportunity_signal_identity.sql"
  ),
  "utf8"
);
const onboardingMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821142000_team_member_onboarding.sql"
  ),
  "utf8"
);
const assignmentMigration = readFileSync(
  path.join(root, "supabase/migrations/20260821160000_team_work_assignment.sql"),
  "utf8"
);
const senderProtectionMigration = readFileSync(
  path.join(root, "supabase/migrations/20260821170000_protect_outreach_sender_identity.sql"),
  "utf8"
);
const serviceScope = readFileSync(path.join(root, "lib/service-scope.ts"), "utf8");
const outreachIdentity = readFileSync(path.join(root, "lib/outreach-identity.ts"), "utf8");
const outreachSendQueue = readFileSync(path.join(root, "lib/outreach-send-queue.ts"), "utf8");
const opportunityRoute = readFileSync(
  path.join(root, "app/api/crm/opportunities/[id]/route.ts"),
  "utf8"
);
const revenueRoute = readFileSync(path.join(root, "app/api/crm/revenue/route.ts"), "utf8");
const pipelineWorkspace = readFileSync(
  path.join(root, "components/crm/PipelineWorkspace.tsx"),
  "utf8"
);
const opportunitySignalCron = readFileSync(
  path.join(root, "app/api/cron/opportunity-signals/route.ts"),
  "utf8"
);
const opportunitySignals = readFileSync(
  path.join(root, "lib/opportunity-signals.ts"),
  "utf8"
);
const companyRoute = readFileSync(
  path.join(root, "app/api/crm/companies/route.ts"),
  "utf8"
);
const contactRoute = readFileSync(
  path.join(root, "app/api/crm/contacts/route.ts"),
  "utf8"
);
const outreachCrm = readFileSync(path.join(root, "lib/outreach-crm.ts"), "utf8");
const middleware = readFileSync(path.join(root, "middleware.ts"), "utf8");
const login = readFileSync(path.join(root, "app/login/page.tsx"), "utf8");
const supabase = readFileSync(path.join(root, "lib/supabase.ts"), "utf8");
const google = readFileSync(path.join(root, "lib/google.ts"), "utf8");
const appConfig = readFileSync(path.join(root, "lib/app-config.ts"), "utf8");
const workspace = readFileSync(path.join(root, "lib/workspace.ts"), "utf8");
const contextRoute = readFileSync(
  path.join(root, "app/api/interview/context/route.ts"),
  "utf8"
);
const documentDownload = readFileSync(
  path.join(root, "app/api/crm/documents/[id]/download/route.ts"),
  "utf8"
);
const storageScope = readFileSync(path.join(root, "lib/storage-scope.ts"), "utf8");
const requestScope = readFileSync(path.join(root, "lib/request-scope.ts"), "utf8");
const teamRoute = readFileSync(
  path.join(root, "app/api/crm/team/route.ts"),
  "utf8"
);
const invitationAcceptance = readFileSync(
  path.join(root, "app/api/auth/team/accept/route.ts"),
  "utf8"
);
const joinTeam = readFileSync(
  path.join(root, "app/join-team/page.tsx"),
  "utf8"
);

const currentTables = [
  "ai_cache",
  "app_config",
  "assistant_messages",
  "call_feedback",
  "client_context",
  "coaching_points",
  "companies",
  "company_priority",
  "contact_company_overrides",
  "contacts",
  "crm_company_redirects",
  "daily_briefs",
  "departments",
  "document_jobs",
  "external_refs",
  "field_definitions",
  "follow_ups",
  "google_oauth",
  "interview_sessions",
  "interview_summaries",
  "knowledge_base",
  "knowledge_docs",
  "lessons",
  "meet_bots",
  "meet_utterances",
  "opportunities",
  "opportunity_events",
  "opportunity_signal_receipts",
  "outreach_campaigns",
  "outreach_enrolments",
  "outreach_events",
  "outreach_learnings",
  "outreach_messages",
  "outreach_prospects",
  "outreach_signals",
  "outreach_suppressions",
  "tasks",
  "upcoming_calls",
  "usage_log",
  "workspace_profile",
  "workstream_contacts",
  "workstreams",
];

for (const table of currentTables) {
  assert.match(
    migration,
    new RegExp(`['\"]${table}['\"]`),
    `${table} is missing from the access-control migration`
  );
}

for (const table of ["google_oauth", "app_config"]) {
  assert.match(
    migration,
    new RegExp(`revoke all on public\\.${table} from anon, authenticated`),
    `${table} must remain server-only`
  );
}

for (const table of [
  "ai_cache",
  "contact_company_overrides",
  "opportunity_signal_receipts",
]) {
  assert.match(
    apiIsolationMigration,
    new RegExp(`grant select, insert, update, delete on public\\.%I`),
    `${table} must be installed through the scoped internal table policy loop`
  );
  assert.match(apiIsolationMigration, new RegExp(`['"]${table}['"]`));
}

assert.match(migration, /current_user_count <> 1/);
assert.match(migration, /visibility = ''private''/);
assert.match(migration, /visibility = ''team''/);
assert.match(migration, /workspace_members/);
assert.match(migration, /access_audit_events/);
assert.match(migration, /only a workspace owner or manager/);
assert.doesNotMatch(
  migration,
  /create or replace function public\.(?:apply|protect|audit)_livecoach_record_scope\(\)[\s\S]*?security definer/i,
  "record-scope trigger functions must not bypass RLS"
);

assert.match(middleware, /from\("workspace_members"\)/);
assert.match(middleware, /workspace access required/);
assert.match(middleware, /path\.startsWith\("\/api\/auth\/google"\)/);
assert.match(middleware, /path\.startsWith\("\/api\/interview"\)/);
assert.match(middleware, /LIVECOACH_ACCESS_TOKEN_HEADER/);
assert.match(middleware, /Cache-Control.*private, no-store/s);
assert.match(middleware, /membership\.status === "onboarding" && isOnboardingApi/);
assert.match(middleware, /isPreMembershipApi/);
assert.match(middleware, /LIVECOACH_WORKSPACE_STATUS_HEADER/);
assert.match(requestScope, /requireWorkspaceOwner/);
assert.match(requestScope, /getVerifiedUser/);

assert.match(supabase, /Authorization: `Bearer \$\{scope\.accessToken\}`/);
assert.match(supabase, /isVerifiedServiceRequest\(\)/);
assert.match(supabase, /throw new Error\(/);
assert.doesNotMatch(
  supabase,
  /if \(!scope\) return supabaseService/,
  "unverified requests must never fall back to the service role"
);

assert.match(google, /\.eq\("owner_id", exactOwner\)/);
assert.match(google, /A Google connector owner must be selected/);
assert.doesNotMatch(google, /\.eq\("id", "main"\)/);
assert.doesNotMatch(workspace, /\.eq\("id", "main"\)/);

assert.match(appConfig, /TEAM_CONFIG_KEYS\.has\(input\.key\)/);
assert.match(appConfig, /requestScope\.role !== "owner"/);
assert.match(appConfig, /requestScope\.role !== "manager"/);
assert.match(appConfig, /cannot be shared with the workspace/);

assert.match(contextRoute, /requireRequestScope\(\)/);
assert.match(contextRoute, /`users\/\$\{account\.userId\}/);
assert.match(contextRoute, /legacyOwner\?\.value === account\.userId/);
assert.doesNotMatch(contextRoute, /account\.role === "owner"/);
assert.match(contextRoute, /storageSegment\(sessionId\)/);
assert.match(storageScope, /SAFE_STORAGE_SEGMENT/);
assert.match(documentDownload, /job\.owner_id !== account\.userId/);
assert.match(documentDownload, /userStoragePrefix\(account\.userId\)/);

for (const index of [
  "ai_cache_owner_key_uidx",
  "app_config_private_owner_key_uidx",
  "app_config_team_workspace_key_uidx",
  "google_oauth_owner_uidx",
  "workspace_profile_owner_uidx",
  "tasks_owner_fingerprint_uidx",
  "upcoming_calls_owner_external_id_uidx",
  "interview_sessions_owner_session_id_uidx",
  "interview_summaries_owner_cache_key_uidx",
  "document_jobs_owner_idempotency_uidx",
]) {
  assert.match(apiIsolationMigration, new RegExp(index));
}
for (const oldKey of [
  "ai_cache_pkey",
  "app_config_pkey",
  "contact_company_overrides_pkey",
  "tasks_fingerprint_key",
  "upcoming_calls_external_id_uidx",
  "interview_sessions_session_id_key",
  "interview_summaries_cache_key_key",
  "document_jobs_idempotency_key_key",
  "company_priority_pkey",
  "opportunity_signal_receipts_company_id_source_record_type_s_key",
  "external_refs_unique",
]) {
  assert.match(keyCleanupMigration, new RegExp(oldKey));
}

assert.match(rpcHardeningMigration, /company_priority_owner_company_uidx/);
for (const fn of [
  "replace_company_priority",
  "merge_crm_companies",
  "merge_crm_companies_by_alias",
]) {
  assert.match(
    rpcHardeningMigration,
    new RegExp(`alter function public\\.${fn}[\\s\\S]*?security invoker`)
  );
  assert.match(
    rpcHardeningMigration,
    new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?authenticated`)
  );
}
assert.match(
  costRollupGrantMigration,
  /grant execute on function public\.crm_dashboard_cost_rollup\(\) to authenticated/
);
assert.match(legacyStorageMigration, /legacy_storage_owner_id/);
assert.match(legacyStorageMigration, /visibility[\s\S]*?'private'/);
assert.match(
  signalScopeMigration,
  /opportunity_signal_receipts_owner_source_uidx/
);
assert.match(
  opportunitySignals,
  /owner_id,company_id,source_record_type,source_record_id/
);
assert.match(opportunitySignals, /\.eq\("owner_id", claimed\.owner_id\)/);
assert.match(opportunitySignals, /\.eq\("workspace_id", claimed\.workspace_id\)/);
assert.match(companyRoute, /name, visibility: "private"/);
assert.match(contactRoute, /let visibility: "private" \| "team" = "private"/);
assert.match(outreachCrm, /visibility: "team"/);

assert.match(onboardingMigration, /status in \('active', 'onboarding', 'suspended', 'removed'\)/);
assert.match(onboardingMigration, /accept_livecoach_invitation/);
assert.match(onboardingMigration, /invitation belongs to a different email address/);
assert.match(onboardingMigration, /status = 'accepted'/);
assert.match(onboardingMigration, /'onboarding'/);
assert.match(
  onboardingMigration,
  /revoke all on function public\.accept_livecoach_invitation[\s\S]*?authenticated/
);
assert.match(teamRoute, /requireWorkspaceOwner\(\)/);
assert.match(teamRoute, /randomBytes\(32\)/);
assert.match(teamRoute, /createHash\("sha256"\)/);
assert.match(teamRoute, /generateLink/);
assert.match(teamRoute, /ready: true/);
assert.match(teamRoute, /workspace_member_activated/);
assert.match(teamRoute, /workspace_member_suspended/);
assert.match(teamRoute, /outreach_sender_email/);
assert.match(joinTeam, /Lee presses Activate/i);
assert.match(assignmentMigration, /assigned_to_user_id/);
assert.match(assignmentMigration, /sender_user_id/);
assert.match(assignmentMigration, /audit_livecoach_work_assignment/);
assert.match(senderProtectionMigration, /profiles_protect_outreach_sender_identity/);
assert.match(senderProtectionMigration, /auth\.uid\(\)/);
assert.match(senderProtectionMigration, /verified account setup/);
assert.match(serviceScope, /AsyncLocalStorage/);
assert.match(supabase, /getServiceRecordScope/);
assert.match(supabase, /Cross-account service insert is not permitted/);
assert.match(outreachIdentity, /resolveOutreachIdentity/);
assert.match(outreachIdentity, /outreach_sender_email/);
assert.match(outreachSendQueue, /sender_user_id/);
assert.match(outreachSendQueue, /ownerId: sender\.userId/);
assert.match(opportunityRoute, /assignedToUserId/);
assert.match(opportunityRoute, /if \(requested !== current\.owner_id\) patch\.visibility = "team"/);
assert.match(opportunityRoute, /linked client, calls, emails and transcripts retain/);
assert.match(revenueRoute, /outreachNameByCompany/);
assert.match(revenueRoute, /canManageAssignments/);
assert.match(pipelineWorkspace, /Deal owner/);
assert.match(pipelineWorkspace, /assigned_to_user_id/);
assert.match(pipelineWorkspace, /canManageAssignments/);
assert.match(opportunitySignalCron, /listActiveAccountScopes/);
assert.match(opportunitySignalCron, /runWithServiceRecordScope/);
assert.match(invitationAcceptance, /getVerifiedUser\(\)/);
assert.match(invitationAcceptance, /accept_livecoach_invitation/);
assert.match(joinTeam, /at least 12 characters/i);
assert.match(joinTeam, /Connect Google/);
assert.match(joinTeam, /CRM access stays locked/i);

assert.doesNotMatch(login, /auth\.signUp/);
assert.doesNotMatch(login, /Create account/);
assert.match(login, /invite only access/i);

console.log(
  `Multi-user API isolation validation passed for ${currentTables.length} existing tables.`
);
