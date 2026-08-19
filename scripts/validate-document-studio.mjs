import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [migration, worker, context, route, assistant, tray] = await Promise.all([
  read("supabase/migrations/20260819180000_brain_document_studio.sql"),
  read("lib/document-jobs.ts"),
  read("lib/document-context.ts"),
  read("app/api/crm/documents/route.ts"),
  read("app/api/crm/assistant/route.ts"),
  read("components/crm/DocumentJobTray.tsx"),
]);

assert.match(migration, /create table if not exists public\.document_jobs/i);
assert.match(migration, /idempotency_key text not null unique/i);
assert.match(migration, /'crm-documents'[\s\S]*?false/i);
assert.match(migration, /enable row level security/i);

assert.match(route, /waitUntil\(processing\)/);
assert.match(route, /status: 202/);
assert.match(route, /\.eq\("idempotency_key", idempotencyKey\)/);

assert.match(worker, /source_refs: source\.refs/);
assert.match(worker, /source_fingerprint: source\.fingerprint/);
assert.doesNotMatch(worker, /\.from\("transcript/i);
assert.match(worker, /status: "quality_check"/);
assert.match(worker, /\.eq\("status", "open"\)/);

assert.match(assistant, /type === "create_document"/);
assert.match(assistant, /FINISHED BUSINESS DOCUMENTS/);
assert.match(assistant, /documentBrainContext\(message\)/);
assert.match(context, /if \(!wantsDocuments\) return ""/);
assert.doesNotMatch(context, /from "docx"/);

assert.match(tray, /if \(!hasActive\) return/);
assert.match(tray, /setTimeout\(load, 2500\)/);
assert.match(tray, /Download Word/);

console.log("Brain Document Studio validation passed");
