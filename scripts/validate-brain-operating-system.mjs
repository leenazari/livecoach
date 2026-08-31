import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260831183616_brain_operating_system.sql"
);
const hardening = read(
  "supabase/migrations/20260831191324_brain_operating_system_advisor_hardening.sql"
);
const control = read("lib/brain-control.ts");
const shared = read("lib/brain-control-shared.ts");
const api = read("app/api/crm/brain-control/route.ts");
const cron = read("app/api/cron/brain-routines/route.ts");
const chatBrain = read("lib/team-chat-brain.ts");
const chatRoute = read("app/api/crm/chat/[conversationId]/messages/route.ts");
const chatPage = read("app/crm/chat/page.tsx");
const page = read("app/crm/brain-control/page.tsx");
const nav = read("components/crm/NavMenu.tsx");
const vercel = read("vercel.json");
const supabase = read("lib/supabase.ts");

for (const table of [
  "brain_sales_plays",
  "brain_trust_rules",
  "brain_routines",
  "brain_routine_runs",
  "brain_pages",
  "brain_learnings",
  "crm_chat_brain_messages",
]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(
    migration,
    new RegExp(`alter table public\\.${table} enable row level security`)
  );
  assert.match(
    migration,
    new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`)
  );
}

assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /wm\.status = 'active'/);
assert.match(migration, /wm\.role in \('owner', 'manager'\)/);
assert.match(migration, /Conversation members read Brain chat messages/);
assert.match(migration, /No browser writes to Brain routine runs/);
assert.match(migration, /No browser writes to Brain chat messages/);
assert.match(hardening, /drop policy if exists "No browser writes to Brain routine runs"/);
assert.match(hardening, /No browser inserts to Brain routine runs/);
assert.match(hardening, /No browser updates to Brain routine runs/);
assert.match(hardening, /No browser deletes from Brain routine runs/);
assert.match(hardening, /No browser inserts to Brain chat messages/);
assert.match(hardening, /brain_routine_runs_routine_scope_fk_idx/);
assert.match(hardening, /crm_chat_brain_messages_source_scope_fk_idx/);
assert.match(migration, /action_kind <> 'destructive_action'[\s\S]*mode = 'blocked'/);
assert.match(
  migration,
  /'customer_communication',[\s\S]*'paid_generation',[\s\S]*'destructive_action',[\s\S]*'shared_learning'[\s\S]*or mode <> 'auto'/
);
assert.match(migration, /status = 'approved_team' and visibility = 'team'/);
assert.match(migration, /unique \(workspace_id, owner_id, idempotency_key\)/);
assert.match(migration, /hard_cost_cap_gbp >= estimated_cost_gbp/g);

for (const table of [
  "brain_learnings",
  "brain_pages",
  "brain_routine_runs",
  "brain_routines",
  "brain_sales_plays",
  "brain_trust_rules",
]) {
  assert.match(supabase, new RegExp(`"${table}"`));
}

assert.match(api, /requireRequestScope\(\)/);
assert.match(api, /waitUntil/);
assert.match(api, /run_routine/);
assert.match(cron, /CRON_SECRET/);
assert.match(cron, /listActiveAccountScopes\(\)/);
assert.match(cron, /runWithServiceRecordScope/);
assert.match(cron, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(cron, /\.eq\("owner_id", account\.userId\)/);
assert.match(vercel, /"path": "\/api\/cron\/brain-routines"/);
assert.match(vercel, /"schedule": "\*\/30 \* \* \* \*"/);

assert.match(control, /PLAY_DEFAULTS/);
assert.match(control, /TRUST_DEFAULTS/);
assert.match(control, /nextRoutineRunAt/);
assert.match(control, /timeZone: "Europe\/London"/);
assert.match(control, /email_assistant_drafts/);
assert.match(control, /\.from\("tasks"\)/);
assert.match(control, /\.from\("upcoming_calls"\)/);
assert.match(control, /\.from\("opportunities"\)/);
assert.match(control, /\.from\("outreach_enrolments"\)/);
assert.match(control, /externalMessagesSent: 0/);
assert.match(control, /crmRecordsChanged: 0/);
assert.match(control, /paidGenerationsCreated: 0/);
assert.match(control, /newResearchCreated: 0/);
assert.doesNotMatch(
  control,
  /openai|messages\.create|generateEmailAssistantDraft|generate.*voice/i,
  "The default routine must not create model or paid-generation cost"
);
assert.equal(
  (control.match(/\.eq\("workspace_id", input\.scope\.workspaceId\)/g) || [])
    .length >= 8,
  true,
  "Routine reads and writes must repeatedly bind the exact workspace"
);
assert.equal(
  (control.match(/\.eq\("owner_id", input\.scope\.userId\)/g) || []).length >=
    8,
  true,
  "Routine reads and writes must repeatedly bind the exact owner"
);

assert.match(shared, /reply_drafts/);
assert.match(shared, /cost_forecast/);
assert.match(page, /Brain Routines/);
assert.match(page, /Saved Sales Plays/);
assert.match(page, /Action Trust Centre/);
assert.match(page, /Visible Background Work Centre/);
assert.match(page, /Internal Live Pages/);
assert.match(page, /Human-Approved Shared Learning/);
assert.match(page, /Cost Forecasting/);
assert.match(page, /Brain inside Team Chat/);
assert.match(page, /Run morning control/);
assert.match(nav, /href: "\/crm\/brain-control"/);

assert.match(chatBrain, /\@brain/);
assert.match(chatBrain, /brainTrustDecision\(input\.scope, "paid_generation"\)/);
assert.match(chatBrain, /crm_chat_conversation_members/);
assert.match(chatBrain, /crm_chat_messages/);
assert.match(chatBrain, /crm_chat_attachments/);
assert.match(chatBrain, /file metadata/);
assert.match(chatBrain, /cannot inspect private CRM records/);
assert.match(chatBrain, /Never claim an external or CRM action happened/);
assert.doesNotMatch(
  chatBrain,
  /\.from\("(?:companies|contacts|opportunities|tasks|client_context|interview_sessions|interview_summaries)"\)/,
  "Team Chat Brain must not reach into private CRM record tables"
);
assert.match(chatRoute, /asksTeamChatBrain\(body\)/);
assert.match(chatRoute, /queueTeamChatBrainReply/);
assert.match(chatRoute, /answerTeamChatBrain/);
assert.match(chatRoute, /senderKind: "brain"/);
assert.match(chatPage, /mention @Brain/);
assert.match(chatPage, /Brain is thinking/);
assert.match(chatPage, /brainThinking/);
assert.match(chatPage, /2_500/);

console.log("Brain operating system checks passed");
