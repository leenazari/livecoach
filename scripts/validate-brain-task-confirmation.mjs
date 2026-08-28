import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const tasks = read("lib/tasks.ts");
const taskRoute = read("app/api/crm/tasks/route.ts");
const assistant = read("components/crm/ClientAssistant.tsx");
const migration = read(
  "supabase/migrations/20260828205050_fix_task_owner_fingerprint_upsert.sql"
);

assert.match(migration, /drop index if exists public\.tasks_owner_fingerprint_uidx/i);
assert.match(
  migration,
  /create unique index tasks_owner_fingerprint_uidx\s+on public\.tasks \(owner_id, fingerprint\)/i
);
assert.doesNotMatch(migration, /where\s+fingerprint\s+is\s+not\s+null/i);

assert.match(tasks, /if \(error\) \{[\s\S]*throw error;/);
assert.doesNotMatch(
  tasks,
  /catch \([^)]*\) \{[\s\S]*upsertTasks failed:[\s\S]*return \[\];/
);

assert.match(taskRoute, /isNearDuplicateTask\(taskText/);
assert.match(taskRoute, /row\.fingerprint === fingerprint/);
assert.match(taskRoute, /ok: true,[\s\S]*task,[\s\S]*alreadyExists:/);
assert.match(taskRoute, /The task was not written or matched to an existing open task/);

assert.match(assistant, /function actionConfirmationError/);
assert.match(
  assistant,
  /action\?\.type === "create_task" && !result\?\.task\?\.id/
);
assert.doesNotMatch(assistant, /result\?\.created === false/);
assert.match(assistant, /actionInFlightRef\.current\.has\(a\.key\)/);
assert.match(assistant, /actionInFlightRef\.current\.add\(a\.key\)/);
assert.match(assistant, /actionInFlightRef\.current\.delete\(a\.key\)/);

console.log("Brain task confirmation validation passed");
