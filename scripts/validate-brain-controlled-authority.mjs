import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260902232717_brain_controlled_authority.sql"
);
const delegationScopeMigration = read(
  "supabase/migrations/20260902234717_scope_brain_delegation_workspace.sql"
);
const authority = read("lib/brain-authority.ts");
const resolver = read("app/api/crm/assistant/route.ts");
const executor = read("app/api/crm/assistant/execute/route.ts");
const undo = read("app/api/crm/assistant/executions/[id]/undo/route.ts");
const assistant = read("components/crm/ClientAssistant.tsx");
const control = read("lib/brain-control.ts");
const controlApi = read("app/api/crm/brain-control/route.ts");
const controlPage = read("app/crm/brain-control/page.tsx");
const sendPilot = read("lib/sendpilot-outreach.ts");
const sendPilotApi = read("lib/sendpilot-api.ts");
const sendPilotControl = read("app/api/crm/sendpilot/control/route.ts");
const sendPilotEnrol = read("app/api/crm/outreach/[id]/sendpilot/route.ts");
const positiveReply = read("lib/outreach-positive-reply.ts");
const sendQueue = read("lib/outreach-send-queue.ts");
const email = read("app/api/crm/assistant/email/route.ts");
const calendar = read("app/api/crm/upcoming/[id]/route.ts");
const calendarCancel = read("app/api/crm/upcoming/[id]/cancel/route.ts");
const calendarProvider = read("lib/calendar-provider.ts");
const google = read("lib/google.ts");
const microsoft = read("lib/microsoft.ts");
const postCall = read("app/api/crm/update-profile/route.ts");
const commercial = read("app/api/crm/calls/[id]/commercial-update/route.ts");
const canonicalOpportunity = read("lib/canonical-opportunity.ts");
const duplicates = read("app/api/crm/duplicates/route.ts");
const merge = read("app/api/crm/duplicates/merge/route.ts");
const contacts = read("app/api/crm/contacts/[id]/route.ts");
const delegation = read("app/api/crm/brain/assign-work/route.ts");
const calendarSync = read("app/api/crm/calendar-sync/route.ts");

assert.match(migration, /create table public\.brain_action_executions/);
assert.match(migration, /unique \(workspace_id, actor_user_id, idempotency_key\)/);
assert.match(migration, /undo_started_at timestamptz/);
assert.match(migration, /undone_at timestamptz/);
assert.match(migration, /estimated_cost_gbp numeric\(12,6\)/);
assert.match(migration, /actual_cost_gbp numeric\(12,6\)/);
assert.match(migration, /alter table public\.brain_action_executions enable row level security/);
assert.match(migration, /No browser inserts to Brain executions/);
assert.match(migration, /No browser updates to Brain executions/);
assert.match(migration, /No browser deletes from Brain executions/);
assert.match(migration, /Workspace owner inserts Brain trust rules/);
assert.match(migration, /actor\.role = 'owner'/);
assert.match(migration, /delegate_brain_work_service/);
assert.match(migration, /p_kind not in \('task', 'call'\)/);
assert.match(migration, /share\.assigned_to_user_id = p_assigned_to_user_id/);
assert.match(migration, /p_kind = 'task'[\s\S]*?status = 'dismissed'/);
assert.match(migration, /grant execute on function public\.delegate_brain_work_service[\s\S]*?to service_role/);
assert.match(migration, /'work_assigned'/);
assert.match(migration, /'brain_work_assignment:' \|\| target_id::text/);
assert.match(delegationScopeMigration, /p_workspace_id uuid/);
assert.match(delegationScopeMigration, /wm\.workspace_id = p_workspace_id/);
assert.match(
  delegationScopeMigration,
  /drop function if exists public\.delegate_brain_work_service\(uuid, text, uuid, uuid\)/
);
assert.match(
  delegationScopeMigration,
  /grant execute on function public\.delegate_brain_work_service\(uuid, uuid, text, uuid, uuid\)[\s\S]*?to service_role/
);

assert.match(authority, /createHmac\("sha256"/);
assert.match(authority, /actorUserId: input\.scope\.userId/);
assert.match(authority, /workspaceId: input\.scope\.workspaceId/);
assert.match(authority, /payload\.actorUserId !== scope\.userId/);
assert.match(authority, /payload\.workspaceId !== scope\.workspaceId/);
assert.match(authority, /canonicalValue\(payload\.action\.body\)/);
assert.match(authority, /assign_work:[\s\S]*?ownerOnly: true[\s\S]*?salesAllowed: false/);
assert.match(authority, /merge_duplicate_clients:[\s\S]*?actionKind: "destructive_action"/);
assert.match(authority, /create_chat:[\s\S]*?canRetry: false/);
assert.match(authority, /sendpilot_enrol:[\s\S]*?canRetry: false/);
assert.match(authority, /scope\.role === "owner" && input\.ownerOverrideRequested === true/);

assert.match(executor, /verifyBrainActionToken\(token, scope\)/);
assert.match(executor, /brainRoleMayExecute\(scope, profile\)/);
assert.match(executor, /brainTrustDecision\(scope, profile\.actionKind\)/);
assert.match(executor, /OWNER_OVERRIDABLE_BLOCKERS\.has\(blockerCode\)/);
assert.match(executor, /ownerOverride: true/);
assert.match(executor, /idempotency_key: payload\.jti/);
assert.match(executor, /captureBeforeState/);
assert.match(executor, /deriveUndo/);
assert.match(executor, /10 \* 60_000/);
assert.match(executor, /estimated_cost_gbp/);
assert.match(executor, /actual_cost_gbp/);
assert.match(executor, /actionCompleted: true/);
assert.match(executor, /auditConfirmed: false/);
assert.match(executor, /canRetry: false/);
assert.match(undo, /actor_user_id", scope\.userId/);
assert.match(undo, /INTERNAL_UNDO_ENDPOINT/);
assert.match(undo, /input\?\.confirmed !== true/);
assert.match(assistant, /\/api\/crm\/assistant\/execute/);
assert.match(assistant, /executionToken: _token/);
assert.match(assistant, /\/undo`/);

assert.match(controlApi, /scope\.role !== "owner"/);
assert.match(control, /Only the active workspace owner can change Brain permissions/);
assert.match(control, /actor_user_id", scope\.userId/);
assert.match(control, /actual_cost_gbp/);
assert.match(controlPage, /Other users see only their own actions/);
assert.match(controlPage, /Owner override used/);
assert.match(controlPage, /Recorded \{gbp\(execution\.actual_cost_gbp\)\}/);

assert.match(resolver, /sendpilot_stop_lead/);
assert.match(resolver, /sendpilot_pause_campaign/);
assert.match(resolver, /sendpilot_resume_campaign/);
assert.match(resolver, /enrolmentId: enrolment\.id/);
assert.match(resolver, /estimatedCostGbp: Number\(message\.voice_estimated_cost_gbp/);
assert.match(resolver, /endpoint: "\/api\/crm\/brain\/assign-work"/);
assert.match(resolver, /assignmentCandidate: true/);
assert.match(resolver, /\.eq\("owner_id", requestScope\.userId\)[\s\S]*?\.in\("status", statuses\)/);
assert.match(resolver, /from\("follow_ups"\)[\s\S]*?\.eq\("owner_id", requestScope\.userId\)/);
assert.match(resolver, /from\("outreach_campaigns"\)[\s\S]*?\.eq\("owner_id", requestScope\.userId\)/);
assert.match(delegation, /requireWorkspaceOwner\(\)/);
assert.match(delegation, /delegation_client_not_assigned/);
assert.match(delegation, /delegate_brain_work_service/);
assert.match(delegation, /p_workspace_id: scope\.workspaceId/);
assert.match(delegation, /providerEventTransferred: false/);
assert.match(sendPilotEnrol, /verifyBrainOwnerOverride/);
assert.match(sendPilotEnrol, /ownerOverride/);
assert.match(sendPilot, /prospect\.assigned_to_user_id !== scope\.userId/);
assert.match(sendPilot, /if \(blocked\?\.length\)/);
assert.match(sendPilot, /!input\.ownerOverride/);
assert.match(sendPilot, /updateSendPilotLeadStatus/);
assert.match(sendPilot, /updateSendPilotCampaign/);
assert.match(sendPilot, /sendpilot_stop_local_update_failed/);
assert.match(sendPilot, /sendpilot_campaign_local_update_failed/);
assert.match(sendPilotControl, /nextAction/);
assert.match(sendPilotApi, /method\?: "GET" \| "POST" \| "PATCH"/);
assert.match(sendPilotApi, /\/v1\/leads\/\$\{encodeURIComponent\(leadId\)\}\/status/);
assert.match(sendPilotApi, /\/v1\/campaigns\/\$\{encodeURIComponent\(campaignId\)\}/);
assert.match(email, /verifyBrainOwnerOverride/);
assert.match(email, /outreach_do_not_contact/);
assert.match(sendQueue, /message\.strategy\?\.ownerOverride === true/);
assert.match(sendQueue, /This person or company is on the do not contact list/);

assert.match(sendPilot, /prepareInterestedReplyPackage/);
assert.match(sendPilot, /ensureSendPilotReplyTask/);
assert.match(sendPilot, /ensureReplyAttentionTask/);
assert.doesNotMatch(
  sendPilot,
  /Review and approve .* positive LinkedIn reply/,
  "An interested reply must not create a second competing follow-up task"
);
assert.match(positiveReply, /reply_category !== "interested"/);
assert.match(positiveReply, /getPersonalOutreachBookingLink/);
assert.match(positiveReply, /Hi \$\{firstName\}, I hope you are doing well today\./);
assert.match(positiveReply, /voice_status: "script_ready"/);
assert.match(positiveReply, /status: "draft"/);

assert.match(calendarProvider, /updateConnectedCalendarEvent/);
assert.match(calendarProvider, /deleteConnectedCalendarEvent/);
assert.match(calendarProvider, /getConnectedCalendarEventState/);
assert.match(google, /getGoogleCalendarEvent/);
assert.match(google, /updateGoogleCalendarEvent/);
assert.match(google, /deleteGoogleCalendarEvent/);
assert.match(microsoft, /getMicrosoftCalendarEvent/);
assert.match(microsoft, /updateMicrosoftCalendarEvent/);
assert.match(microsoft, /deleteMicrosoftCalendarEvent/);
assert.match(calendar, /calendar_event_not_linked/);
assert.match(calendar, /calendar_crm_partial_failure/);
assert.match(calendar, /calendar_cancel_partial_failure/);
assert.match(calendar, /rollback/);
assert.match(calendarCancel, /export \{ POST \} from "\.\.\/route"/);

assert.match(postCall, /requireRequestScope\(\)/);
assert.match(postCall, /loadAssignedClientAccess/);
assert.match(postCall, /sessionId is required/);
assert.match(postCall, /from\("interview_summaries"\)/);
assert.match(postCall, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(postCall, /\.eq\("owner_id", scope\.userId\)/);
assert.match(postCall, /access\.mode === "owner"/);
assert.match(postCall, /profileUpdated: access\.mode === "owner"/);
assert.match(commercial, /loadAssignedClientAccess/);
assert.match(commercial, /assigned_to_user_id\.eq\.\$\{scope\.userId\}/);
assert.match(canonicalOpportunity, /\.eq\("workspace_id", actor\.workspaceId\)/);
assert.match(canonicalOpportunity, /assigned_to_user_id\.eq\.\$\{actor\.userId\}/);
assert.match(duplicates, /requireWorkspaceOwner\(\)/);
assert.match(merge, /requireWorkspaceOwner\(\)/);
assert.match(merge, /confirmed !== true/);
assert.match(contacts, /requireRequestScope\(\)/);
assert.match(contacts, /loadAssignedClientAccess/);
assert.match(contacts, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(contacts, /\.eq\("owner_id", scope\.userId\)/);
assert.doesNotMatch(calendarSync, /deriveClientsFromTitles/);
assert.doesNotMatch(calendarSync, /auto_created_from: "calendar-title"/);

console.log("Brain controlled authority validation passed");
