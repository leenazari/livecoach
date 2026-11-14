import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const cache = new Map();

function loadTs(file) {
  const abs = path.resolve(file);
  if (cache.has(abs)) return cache.get(abs);
  const source = readFileSync(abs, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const dirname = path.dirname(abs);
  const localRequire = (specifier) => {
    if (specifier.startsWith(".")) {
      const resolved = path.resolve(dirname, specifier);
      return loadTs(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
    }
    return nodeRequire(specifier);
  };
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  cache.set(abs, module.exports);
  return module.exports;
}

const { estimateInterviewerWait } = loadTs(new URL("../lib/interviewer/wait-estimate.ts", import.meta.url).pathname);
const { INTERVIEWER_VOICES, isInterviewerVoiceId } = loadTs(new URL("../lib/interviewer/voices.ts", import.meta.url).pathname);
const { buildInterviewerPrompt } = loadTs(new URL("../lib/interviewer/prompt.ts", import.meta.url).pathname);
const { isDeepgramConcurrencyRefusal } = loadTs(new URL("../lib/interviewer/concurrency.ts", import.meta.url).pathname);
const { interviewerReadyEmailStatus } = loadTs(new URL("../lib/interviewer/ready-email.ts", import.meta.url).pathname);
const { INTERVIEWER_FUNCTIONS } = loadTs(new URL("../lib/interviewer/agent-settings.ts", import.meta.url).pathname);

const front = estimateInterviewerWait({ position: 1, slotLimit: 43, recentSeconds: [] });
if (front.overTenMinutes || front.label !== "Less than a minute") {
  throw new Error(`front of queue estimate was ${front.label}`);
}

const unknown = estimateInterviewerWait({ position: 4, slotLimit: 43, recentSeconds: [] });
if (unknown.overTenMinutes || unknown.lowMinutes !== null) {
  throw new Error("empty history invented a wait");
}

const over = estimateInterviewerWait({
  position: 44,
  slotLimit: 1,
  recentSeconds: [600, 700, 800, 900],
});
if (!over.overTenMinutes || over.label !== "Over 10 minutes") {
  throw new Error(`expected over 10 minutes, got ${over.label}`);
}

const short = estimateInterviewerWait({
  position: 2,
  slotLimit: 43,
  recentSeconds: [120, 180, 150, 160],
});
if (short.overTenMinutes) throw new Error("a short queue was marked over 10 minutes");

if (INTERVIEWER_VOICES.map((voice) => voice.id).join() !== "aura-2-draco-en,aura-2-pandora-en") {
  throw new Error("voice ids changed");
}
if (!isInterviewerVoiceId("aura-2-draco-en") || isInterviewerVoiceId("aura-2-thalia-en")) {
  throw new Error("voice guard failed");
}

const prompt = buildInterviewerPrompt({
  campaignName: "Northwind",
  prospectName: "Ada",
  personaOverride: "Keep it brief.",
  promptOverride: null,
  maxMinutes: 12,
  documents: [{ title: "Offer", body: "Mention the pilot only if they ask." }],
});
for (const required of [
  "British English",
  "never pushy",
  "When are you looking to move on this?",
  "Hot",
  "Warm",
  "Nurture",
  "Bounced",
  "Wrong number",
  "Competitor chosen",
  "Timing push",
  "Closed lost",
  "Mention the pilot only if they ask.",
]) {
  if (!prompt.includes(required)) throw new Error(`prompt missing ${required}`);
}

if (!isDeepgramConcurrencyRefusal({ code: 429, message: "" })) throw new Error("429");
if (!isDeepgramConcurrencyRefusal({ message: "Too many concurrent connections" })) throw new Error("text");
if (isDeepgramConcurrencyRefusal({ closeCode: 1006, message: "abnormal" })) {
  throw new Error("blip treated as concurrency");
}

const names = INTERVIEWER_FUNCTIONS.map((fn) => fn.name);
for (const name of ["suggest_meeting_times", "book_meeting", "capture_timing", "record_disposition", "end_call"]) {
  if (!names.includes(name)) throw new Error(`missing function ${name}`);
}
const booking = INTERVIEWER_FUNCTIONS.find((fn) => fn.name === "book_meeting");
if (!booking || booking.defer_until_eot !== true) throw new Error("booking must wait for end of turn");
if (interviewerReadyEmailStatus() !== "disabled") throw new Error("ready email must stay disabled");

const { PGlite } = await import("@electric-sql/pglite");
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create schema storage;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table auth.users (id uuid primary key);
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table public.workspaces (id uuid primary key);
  create table public.workspace_members (
    workspace_id uuid references public.workspaces(id) on delete cascade,
    user_id uuid references auth.users(id) on delete cascade,
    role text,
    status text,
    primary key (workspace_id, user_id)
  );
`);
const migration = readFileSync(new URL("../supabase/migrations/20261114130000_interviewer_foundation.sql", import.meta.url), "utf8");
await db.exec(migration);

const workspace = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
await db.query(`insert into auth.users (id) values ($1)`, [owner]);
await db.query(`insert into public.workspaces (id) values ($1)`, [workspace]);
await db.query(
  `insert into public.workspace_members (workspace_id, user_id, role, status) values ($1, $2, 'owner', 'active')`,
  [workspace, owner]
);
await db.query(
  `insert into public.interviewer_access (workspace_id, user_id) values ($1, $2) on conflict do nothing`,
  [workspace, owner]
);
await db.query(`update public.interviewer_config set max_concurrent_slots = 1 where id = 1`);
const campaign = await db.query(
  `insert into public.interviewer_campaigns (workspace_id, owner_id, name, voice_id, rate_per_minute, currency, margin_percent, billing_granularity)
   values ($1, $2, 'Pilot', 'aura-2-draco-en', 2.5, 'GBP', 20, 'minute') returning id`,
  [workspace, owner]
);
const campaignId = campaign.rows[0].id;
const invite = await db.query(
  `insert into public.interviewer_invites (workspace_id, campaign_id, prospect_name, expires_at, created_by)
   values ($1, $2, 'Ada', now() + interval '1 day', $3) returning token`,
  [workspace, campaignId, owner]
);
const token = invite.rows[0].token;
const first = await db.query(`select public.claim_interviewer_slot($1, null) as state`, [token]);
if (first.rows[0].state.state !== "claimed") throw new Error(`first claim was ${JSON.stringify(first.rows[0].state)}`);
const sessionId = first.rows[0].state.sessionId;
await db.query(`update public.interviewer_sessions set connected_at = now() - interval '4 minutes', status = 'connected' where id = $1`, [sessionId]);
const secondInvite = await db.query(
  `insert into public.interviewer_invites (workspace_id, campaign_id, prospect_name, expires_at, created_by)
   values ($1, $2, 'Bea', now() + interval '1 day', $3) returning token`,
  [workspace, campaignId, owner]
);
const queued = await db.query(`select public.claim_interviewer_slot($1, null) as state`, [secondInvite.rows[0].token]);
if (queued.rows[0].state.state === "claimed") throw new Error("second caller took the only seat");
if (Number(queued.rows[0].state.position) !== 1) throw new Error(`queue position ${queued.rows[0].state.position}`);
const beat = await db.query(`select public.heartbeat_interviewer_slot($1, $2) as state`, [token, sessionId]);
if (beat.rows[0].state.ok !== true) throw new Error("heartbeat failed");
await db.query(`update public.interviewer_slots set last_heartbeat_at = now() - interval '1 minute' where session_id = $1`, [sessionId]);
const advanced = await db.query(`select public.interviewer_queue_status($1, $2) as state`, [secondInvite.rows[0].token, queued.rows[0].state.sessionId]);
if (advanced.rows[0].state.state !== "offered" && advanced.rows[0].state.state !== "claimed") {
  throw new Error(`stale seat did not move the queue: ${JSON.stringify(advanced.rows[0].state)}`);
}
const billed = await db.query(`select status, billable_seconds from public.interviewer_sessions where id = $1`, [sessionId]);
if (billed.rows[0].status !== "ended" || Number(billed.rows[0].billable_seconds) < 120) {
  throw new Error(`stale session billing ${JSON.stringify(billed.rows[0])}`);
}
const ended = await db.query(`select public.end_interviewer_session($1, $2) as state`, [secondInvite.rows[0].token, queued.rows[0].state.sessionId]);
if (Number(ended.rows[0].state.billableSeconds) !== 0) throw new Error("queue time was billed");

console.log("interviewer slice checks passed");
