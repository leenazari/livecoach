import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821100624_multi_user_security_foundation.sql"
  ),
  "utf8"
);
const apiIsolationMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821131406_multi_user_api_isolation.sql"
  ),
  "utf8"
);
const keyCleanupMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821133426_remove_global_single_user_keys.sql"
  ),
  "utf8"
);
const rpcHardeningMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821131932_harden_multi_user_rpcs.sql"
  ),
  "utf8"
);
const costRollupGrantMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821132030_grant_scoped_cost_rollup.sql"
  ),
  "utf8"
);
const legacyStorageMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821132316_bind_legacy_storage_owner.sql"
  ),
  "utf8"
);
const signalScopeMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821132618_scope_opportunity_signal_identity.sql"
  ),
  "utf8"
);
const onboardingMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260821135017_team_member_onboarding.sql"
  ),
  "utf8"
);
const invitationConflictFixMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260824170744_auto_activate_verified_team_invites.sql"
  ),
  "utf8"
);
const automaticInvitationActivationMigration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260824170744_auto_activate_verified_team_invites.sql"
  ),
  "utf8"
);
const assignmentMigration = readFileSync(
  path.join(root, "supabase/migrations/20260821165615_team_work_assignment.sql"),
  "utf8"
);
const senderProtectionMigration = readFileSync(
  path.join(root, "supabase/migrations/20260821170222_protect_outreach_sender_identity.sql"),
  "utf8"
);
const microsoftMigration = readFileSync(
  path.join(root, "supabase/migrations/20260821204718_microsoft_connector_foundation.sql"),
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
const microsoft = readFileSync(path.join(root, "lib/microsoft.ts"), "utf8");
const providerMail = readFileSync(path.join(root, "lib/mail.ts"), "utf8");
const publicAppUrl = readFileSync(path.join(root, "lib/public-app-url.ts"), "utf8");
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
const teamPage = readFileSync(
  path.join(root, "app/settings/team/page.tsx"),
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
const googleCallback = readFileSync(
  path.join(root, "app/api/auth/google/callback/route.ts"),
  "utf8"
);
const microsoftCallback = readFileSync(
  path.join(root, "app/api/auth/microsoft/callback/route.ts"),
  "utf8"
);
const calendarSync = readFileSync(
  path.join(root, "app/api/crm/calendar-sync/route.ts"),
  "utf8"
);
const bulkOutreachAssignment = readFileSync(
  path.join(root, "app/api/crm/outreach/assign/route.ts"),
  "utf8"
);
const outreachAssignment = readFileSync(
  path.join(root, "lib/outreach-assignment.ts"),
  "utf8"
);
const outreachPage = readFileSync(
  path.join(root, "app/crm/outreach/page.tsx"),
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
assert.match(middleware, /path\.startsWith\("\/api\/auth\/microsoft"\)/);
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
assert.match(microsoftMigration, /create table if not exists public\.microsoft_oauth/);
assert.match(microsoftMigration, /alter table public\.microsoft_oauth enable row level security/);
assert.match(microsoftMigration, /revoke all on public\.microsoft_oauth from public, anon, authenticated/);
assert.match(microsoftMigration, /microsoft_oauth_owner_uidx/);
assert.match(microsoft, /Cross-account Microsoft access is not permitted/);
assert.match(microsoft, /A Microsoft connector owner must be selected/);
assert.match(microsoft, /freshReplyOnly\(raw, max\)/);
assert.match(providerMail, /sendGmailOutreach\(\{ \.\.\.opts, text, html \}\)/);
assert.match(providerMail, /Microsoft outreach must use the connected mailbox address/);

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
assert.match(contactRoute, /\.\.\.privateRecordFields\(scope\)/);
assert.doesNotMatch(
  contactRoute,
  /company\.visibility === "team" \? "team" : "private"/,
  "A contact added to an assigned client must remain private to its creator"
);
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
assert.match(
  invitationConflictFixMigration,
  /on conflict on constraint workspace_members_pkey do update/i
);
assert.doesNotMatch(
  invitationConflictFixMigration,
  /on conflict \(workspace_id, user_id\) do update/i
);
assert.match(
  automaticInvitationActivationMigration,
  /invitation belongs to a different email address/
);
assert.match(
  automaticInvitationActivationMigration,
  /status = 'pending'[\s\S]*?expires_at > now\(\)/
);
assert.match(
  automaticInvitationActivationMigration,
  /on conflict on constraint workspace_members_pkey do update[\s\S]*?status = 'active'/i
);
assert.match(
  automaticInvitationActivationMigration,
  /workspace_member_auto_activated/
);
assert.match(
  automaticInvitationActivationMigration,
  /select invitation\.workspace_id, invitation\.role, 'active'::text/
);
assert.match(
  automaticInvitationActivationMigration,
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
assert.match(teamRoute, /workspaceOwnerIdentities/);
assert.match(teamRoute, /memberSetupEvidence/);
assert.match(teamRoute, /workspace_member_privacy_test_confirmed/);
assert.match(teamRoute, /assignedProspects/);
assert.match(teamRoute, /sentMessages/);
assert.match(teamRoute, /transcribedCalls/);
assert.match(teamRoute, /A privacy test requires a genuinely separate email address/);
assert.match(teamRoute, /This Google account is already connected to another workspace member/);
assert.match(teamRoute, /This Microsoft account is already connected to another workspace member/);
assert.match(teamRoute, /CRM access is provider-neutral/);
assert.match(teamRoute, /publicAppOrigin\(req\.nextUrl\.origin\)/);
assert.match(teamRoute, /workspace_invitation_replaced/);
assert.match(publicAppUrl, /stale local development value/i);
assert.match(publicAppUrl, /https:\/\/www\.livecoachcrm\.com/);
assert.doesNotMatch(
  teamRoute,
  /This person must connect their own Google account before activation/
);
assert.match(teamPage, /Salesperson setup checklist/);
assert.match(teamPage, /I tested isolation and confirm/);
assert.match(teamPage, /Ready for live outreach/);
assert.match(teamPage, /salesperson@company\.com/);
assert.match(teamPage, /ownerIdentityConflict/);
assert.match(teamPage, />Resend<\/button>/);
assert.match(googleCallback, /membership\.role !== "owner" && !email/);
assert.match(googleCallback, /verifyGoogleOAuthState/);
assert.match(googleCallback, /saveGoogleConnectionForOwner/);
assert.match(googleCallback, /oauthState\.workspaceId/);
assert.match(googleCallback, /oauthState\.userId/);
assert.match(googleCallback, /account_in_use/);
assert.match(googleCallback, /workspace_members/);
assert.match(googleCallback, /google_oauth/);
assert.match(microsoftCallback, /microsoft_oauth/);
assert.match(microsoftCallback, /account_in_use/);
assert.match(microsoftCallback, /saveMicrosoftConnection/);
assert.match(joinTeam, /Google account already belongs to another LiveCoach user/);
assert.match(joinTeam, /Connect Microsoft/);
assert.match(joinTeam, /Email and calendar are optional/);
assert.match(calendarSync, /listConnectedCalendarSnapshot/);
assert.match(calendarSync, /source === "microsoft" \? `microsoft:\$\{ev\.id\}`/);
assert.match(calendarSync, /connectedOnly: true/);
assert.match(joinTeam, /Access active/);
assert.match(joinTeam, /legacy Activate button/);
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
assert.match(joinTeam, /at least 8 characters/i);
assert.match(joinTeam, /Connect Google/);
assert.doesNotMatch(joinTeam, /CRM access stays locked until Lee/i);
assert.match(bulkOutreachAssignment, /account\.role !== "owner"/);
assert.match(bulkOutreachAssignment, /account\.role !== "manager"/);
assert.match(bulkOutreachAssignment, /workspace_members/);
assert.match(bulkOutreachAssignment, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(bulkOutreachAssignment, /isUntouchedOutreachAssignment/);
assert.match(outreachAssignment, /prospect\.status === "imported"/);
assert.match(outreachAssignment, /!prospect\.last_researched_at/);
assert.match(outreachAssignment, /!prospect\.last_contacted_at/);
assert.match(outreachAssignment, /!prospect\.last_reply_at/);
assert.match(outreachAssignment, /!hasSavedOutreachResearch\(prospect\.research\)/);
assert.match(outreachAssignment, /!activity\.hasMessage/);
assert.match(outreachAssignment, /!activity\.hasEnrolment/);
assert.match(outreachAssignment, /!activity\.hasRecipientMessage/);
assert.match(outreachAssignment, /isPristinePausedOutreachEnrolment/);
assert.match(bulkOutreachAssignment, /messageProspectIds/);
assert.match(bulkOutreachAssignment, /messageRecipientEmails/);
assert.match(bulkOutreachAssignment, /enrolmentsByProspect/);
assert.match(bulkOutreachAssignment, /assigned_to_user_id: assignedToUserId/);
assert.match(outreachPage, /Share untouched prospects/);
assert.match(outreachPage, /Assignment only · no research · no emails/);
assert.match(outreachPage, /Owner filter/);

assert.doesNotMatch(login, /auth\.signUp/);
assert.doesNotMatch(login, /Create account/);
assert.match(login, /invite only access/i);

console.log(
  `Multi-user API isolation validation passed for ${currentTables.length} existing tables.`
);
