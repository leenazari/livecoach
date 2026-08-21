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
const middleware = readFileSync(path.join(root, "middleware.ts"), "utf8");
const login = readFileSync(path.join(root, "app/login/page.tsx"), "utf8");

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

for (const table of [
  "google_oauth",
  "ai_cache",
  "app_config",
  "contact_company_overrides",
  "opportunity_signal_receipts",
]) {
  assert.match(
    migration,
    new RegExp(`revoke all on public\\.${table} from anon, authenticated`),
    `${table} must remain server-only`
  );
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
assert.match(middleware, /Cache-Control.*private, no-store/s);

assert.doesNotMatch(login, /auth\.signUp/);
assert.doesNotMatch(login, /Create account/);
assert.match(login, /invite only access/i);

console.log(
  `Multi-user foundation validation passed for ${currentTables.length} existing tables.`
);
