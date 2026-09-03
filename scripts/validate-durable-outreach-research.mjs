import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const page = read("app/crm/outreach/page.tsx");
const route = read("app/api/crm/outreach/research-jobs/route.ts");
const processor = read("app/api/crm/outreach/research-jobs/processor.ts");
const cron = read("app/api/cron/outreach-research-jobs/route.ts");
const identity = read("lib/outreach-identity.ts");
const voiceScript = read(
  "app/api/crm/outreach/messages/[id]/voice-script/route.ts"
);
const vercel = read("vercel.json");
const migration = read(
  "supabase/migrations/20260903172529_durable_outreach_research_jobs.sql"
);
const indexMigration = read(
  "supabase/migrations/20260903174500_index_outreach_research_job_foreign_keys.sql"
);

assert.match(migration, /create table public\.outreach_research_jobs/);
assert.match(migration, /enable row level security/);
assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /jsonb_array_length[\s\S]*> 50/);
assert.match(migration, /least\(2,[\s\S]*active_count/);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /lease_expires_at/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /assigned_to_user_id = p_owner_id/);
assert.match(migration, /timezone\('Europe\/London', now\(\)\)::date/);
assert.match(migration, /google_oauth[\s\S]*microsoft_oauth/);
assert.match(indexMigration, /outreach_research_jobs_owner_fk_idx/);
assert.match(indexMigration, /outreach_research_jobs_prospect_fk_idx/);
assert.match(indexMigration, /outreach_research_jobs_enrolment_fk_idx/);
assert.match(indexMigration, /outreach_research_jobs_message_fk_idx/);
assert.match(indexMigration, /outreach_research_jobs_result_message_fk_idx/);

assert.match(route, /const MAX_BATCH_SIZE = 50/);
assert.match(route, /resolveRecordScope\(\)/);
assert.match(route, /resolveOutreachIdentity\(account\.userId\)/);
assert.match(route, /assigned_to_user_id !== account\.userId/);
assert.match(route, /enqueue_outreach_research_jobs/);
assert.match(route, /waitUntil\(/);
assert.match(route, /internalAppOrigin/);
assert.match(route, /body\?\.resume !== true/);

assert.match(processor, /const ACCOUNT_CONCURRENCY = 2/);
assert.match(processor, /claim_outreach_research_jobs/);
assert.match(processor, /\.eq\("lock_token", job\.lock_token\)/);
assert.match(processor, /LiveCoach will retry automatically/);
assert.match(processor, /authCookie/);
assert.match(processor, /Cookie: authCookie/);
assert.match(processor, /runWithServiceRecordScope/);

assert.match(cron, /listActiveAccountScopes\(\)/);
assert.match(cron, /processOutreachResearchJobs/);
assert.match(vercel, /"path": "\/api\/cron\/outreach-research-jobs"/);
assert.match(vercel, /"schedule": "\* \* \* \* \*"/);

assert.match(page, /OUTREACH_URLS\.researchJobs/);
assert.match(page, /enqueuePrepareBatch\(ids, true\)/);
assert.match(page, /Saved on the server/);
assert.match(page, /You can leave this page and it will continue/);
assert.doesNotMatch(page, /livecoach:outreach-prepare-queue/);
assert.doesNotMatch(page, /activePrepareRef/);
assert.doesNotMatch(page, /\/api\/crm\/outreach\/\$\{prospectId\}\/prepare/);

assert.match(identity, /Repair only missing fields/);
assert.match(identity, /senderPatch\.outreach_sender_email = mailboxEmail/);
assert.match(identity, /\.eq\("user_id", scope\.userId\)/);
assert.doesNotMatch(
  voiceScript,
  /from\("outreach_enrolments"\)[\s\S]{0,180}\.eq\("owner_id", sender\.userId\)/
);
assert.match(processor, /supabaseService/);

console.log("Durable outreach research queue checks passed");
