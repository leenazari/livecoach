import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);

function compile(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (name) => (name.startsWith("@/") ? {} : require(name)),
    module,
    module.exports
  );
  return module.exports;
}

const rules = compile("lib/lead-clash-rules.ts");

assert.equal(
  rules.leadClashSwitchEnabled({ databaseEnabled: false, databaseReadable: true }),
  false
);
assert.equal(
  rules.leadClashSwitchEnabled({ databaseEnabled: null, databaseReadable: true }),
  false
);
assert.equal(
  rules.leadClashSwitchEnabled({ databaseReadable: false, databaseEnabled: true }),
  false
);
assert.equal(
  rules.leadClashSwitchEnabled({
    forceOff: "1",
    databaseEnabled: true,
    databaseReadable: true,
  }),
  false
);
assert.equal(
  rules.leadClashSwitchEnabled({
    enabledEnv: "off",
    databaseEnabled: true,
    databaseReadable: true,
  }),
  false
);
assert.equal(
  rules.leadClashSwitchEnabled({
    enabledEnv: "true",
    databaseEnabled: false,
    databaseReadable: true,
  }),
  false,
  "an environment value cannot turn the check on"
);
assert.equal(
  rules.leadClashSwitchEnabled({ databaseEnabled: true, databaseReadable: true }),
  true
);

assert.equal(rules.isExcludedMatchDomain("gmail.com"), true);
assert.equal(rules.isExcludedMatchDomain("https://www.outlook.com/mail"), true);
assert.equal(rules.isExcludedMatchDomain("AI13.com"), true);
assert.equal(rules.isExcludedMatchDomain("interviewa.com"), true);
assert.equal(rules.isExcludedMatchDomain("northwind.example"), false);
assert.equal(rules.emailDomain("Ada@Gmail.com"), "gmail.com");
assert.equal(rules.companyNameKey("Northwind College Ltd"), rules.companyNameKey("northwind college"));
assert.equal(rules.possibleCompanyNameKey("Northwind College Group"), rules.possibleCompanyNameKey("Northwind College"));
assert.notEqual(rules.companyNameKey("Northwind College Group"), rules.companyNameKey("Northwind College"));
assert.equal(rules.linkedinSlug("https://uk.linkedin.com/in/Ada-Example/"), "ada-example");
assert.equal(rules.contactLabel("Bethany Craine"), "Bethany C.");
assert.equal(rules.contactLabel("Bethany"), "Bethany");
assert.equal(
  rules.isExcludedLeadClashCompany({ name: "Test Client Northstar", profile: {} }),
  true
);
assert.equal(
  rules.isExcludedLeadClashCompany({ name: "Northwind", profile: { lead_clash_exclude: "true" } }),
  true
);
assert.equal(rules.isExcludedLeadClashCompany({ name: "Testing Tools", profile: {} }), false);

assert.equal(
  rules.sharesCalendarEvent({
    attendeeEmails: ["sam@example.test"],
    otherEmails: ["Sam@example.test"],
  }),
  true
);
assert.equal(
  rules.sharesCalendarEvent({
    externalIds: ["evt-1"],
    otherExternalIds: ["evt-1"],
  }),
  true
);
assert.equal(
  rules.sharesCalendarEvent({
    meetingUrls: ["https://meet.example/abc?x=1"],
    otherMeetingUrls: ["https://meet.example/abc"],
  }),
  true
);
assert.equal(
  rules.sharesCalendarEvent({
    externalIds: ["evt-1"],
    otherExternalIds: ["evt-2"],
    attendeeEmails: ["a@example.test"],
    otherEmails: ["b@example.test"],
  }),
  false
);

const pages = await rules.collectPages(async (from, to) => {
  const all = Array.from({ length: 1001 }, (_, index) => index);
  return { data: all.slice(from, to + 1), error: null };
});
assert.equal(pages.length, 1001);
assert.equal(pages[0], 0);
assert.equal(pages[1000], 1000);

const prepared = rules.prepareCompaniesForDuplicateScan(
  [
    { id: "1", name: "Gmail Inbox", domain: "gmail.com", website: null, profile: {} },
    { id: "2", name: "Test Client Northstar", domain: "northstar.example", website: null, profile: {} },
    { id: "3", name: "Northwind", domain: "northwind.example", website: null, profile: {} },
  ],
  { excludeGenericDomains: true, excludeTestRecords: true }
);
assert.deepEqual(prepared.map((company) => company.id), ["1", "3"]);
assert.equal(prepared[0].domain, null);
assert.equal(prepared[1].domain, "northwind.example");
const contacts = rules.prepareContactsForDuplicateScan(
  [{ email: "a@ai13.com" }, { email: "b@northwind.example" }],
  { excludeInternalEmails: true }
);
assert.equal(contacts[0].email, null);
assert.equal(contacts[1].email, "b@northwind.example");

const parsed = rules.parseLeadClashMatches([
  {
    other_user_id: "11111111-1111-4111-8111-111111111111",
    other_display_name: "Sam",
    company_name: "Northwind",
    contact_label: "Ada L.",
    last_touch_at: "2026-10-21T00:00:00Z",
    last_touch_kind: "call",
    next_touch_at: null,
    match_type: "domain",
    match_value: "northwind.example",
    other_company_id: "22222222-2222-4222-8222-222222222222",
    confidential: false,
    disposition: "clash",
    notes: "SECRET_NOTE_SHOULD_NOT_LEAK",
    email: "ada@northwind.example",
  },
  {
    other_user_id: "33333333-3333-4333-8333-333333333333",
    other_display_name: "Sam",
    company_name: "Hidden",
    match_type: "person",
    disposition: "shared",
    confidential: false,
  },
]);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].contactLabel, "Ada L.");
assert.equal(JSON.stringify(parsed).includes("SECRET_NOTE_SHOULD_NOT_LEAK"), false);
assert.equal(JSON.stringify(parsed).includes("ada@northwind.example"), false);
assert.equal(rules.actionableClashes(parsed).length, 1);
assert.match(rules.clashSummary(parsed[0]), /Sam is working Northwind/);
assert.match(rules.clashSummary(parsed[0]), /Ada L/);
assert.doesNotMatch(rules.clashSummary(parsed[0]), /@/);

const companiesRoute = read("app/api/crm/companies/route.ts");
const companyEdit = read("app/api/crm/companies/[id]/route.ts");
const contactsRoute = read("app/api/crm/contacts/route.ts");
const contactEdit = read("app/api/crm/contacts/[id]/route.ts");
const calendar = read("app/api/crm/calendar-sync/route.ts");
const emailPull = read("app/api/crm/email-pull/route.ts");
const server = read("lib/lead-clash.ts");
const migration = read("supabase/migrations/20261101163000_lead_clash_phase1.sql");
const down = read("supabase/rollbacks/20261101163000_lead_clash_phase1_down.sql");

assert.match(companiesRoute, /guardManualLeadClash/);
assert.match(companyEdit, /guardManualLeadClash/);
assert.match(contactsRoute, /guardManualLeadClash/);
assert.match(contactEdit, /guardManualLeadClash/);
assert.match(calendar, /automatedCompanyCreateHeld/);
assert.match(emailPull, /automatedCompanyCreateHeld/);
assert.match(server, /LEAD_CLASH_FORCE_OFF/);
assert.match(server, /return null/);
assert.match(migration, /enabled boolean not null default false/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = ''/);
assert.doesNotMatch(down, /drop table if exists public\.companies/i);
assert.match(down, /drop function if exists public\.lead_clash_check/);
assert.equal(down.includes("drop table if exists public.companies"), false);

const db = new PGlite();
const workspace = randomUUID();
const owner = randomUUID();
const sam = randomUUID();
const outsider = randomUUID();
const northwind = randomUUID();
const gmailCompany = randomUUID();
const internalCompany = randomUUID();
const testCompany = randomUUID();
const confidential = randomUUID();

await db.exec(`
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table auth.users (id uuid primary key);
create table public.workspaces (id uuid primary key);
create table public.workspace_members (
  workspace_id uuid,
  user_id uuid,
  role text,
  status text,
  primary key (workspace_id, user_id)
);
create table public.profiles (
  user_id uuid primary key,
  display_name text,
  email text
);
create table public.companies (
  id uuid primary key,
  workspace_id uuid,
  owner_id uuid,
  name text,
  domain text,
  website text,
  profile jsonb default '{}'::jsonb,
  is_confidential boolean not null default false,
  notes text,
  updated_at timestamptz default now()
);
create table public.contacts (
  id uuid primary key,
  workspace_id uuid,
  owner_id uuid,
  company_id uuid,
  name text,
  email text,
  attributes jsonb default '{}'::jsonb
);
create table public.upcoming_calls (
  id uuid primary key,
  workspace_id uuid,
  owner_id uuid,
  company_id uuid,
  external_id text,
  meeting_url text,
  scheduled_at timestamptz,
  completed_at timestamptz
);
create table public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  user_id uuid,
  kind text not null,
  title text,
  body text,
  href text,
  source_table text not null,
  source_id text,
  source_event_key text,
  created_at timestamptz default now(),
  constraint crm_notifications_kind_check check (
    kind in ('outreach_reply', 'important_email', 'lead_assigned', 'chat_message', 'work_assigned')
  ),
  constraint crm_notifications_source_table_check check (
    source_table in ('outreach_prospects', 'opportunities', 'companies', 'crm_chat_messages', 'tasks')
  )
);
alter table public.companies enable row level security;
grant select on public.companies to authenticated;
create policy own_companies on public.companies for select to authenticated
  using (owner_id = auth.uid());
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on public.workspace_members to authenticated;
`);
await db.exec(migration);

await db.query("insert into auth.users values ($1),($2),($3)", [owner, sam, outsider]);
await db.query("insert into public.workspaces values ($1)", [workspace]);
await db.query(
  "insert into public.workspace_members values ($1,$2,'owner','active'),($1,$3,'sales','active')",
  [workspace, owner, sam]
);
await db.query(
  "insert into public.profiles values ($1,'Lee Owner','lee@example.test'),($2,'Sam Rep','sam@example.test')",
  [owner, sam]
);
await db.query(
  `insert into public.companies
   (id, workspace_id, owner_id, name, domain, notes, updated_at)
   values ($1,$2,$3,'Northwind College','northwind.example','SECRET_NOTE_SHOULD_NOT_LEAK', now())`,
  [northwind, workspace, sam]
);
await db.query(
  `insert into public.contacts (id, workspace_id, owner_id, company_id, name, email, attributes)
   values ($1,$2,$3,$4,'Ada Lovelace','ada@gmail.com','{"linkedin":"https://www.linkedin.com/in/ada-example"}')`,
  [randomUUID(), workspace, sam, northwind]
);
await db.query(
  `insert into public.upcoming_calls
   (id, workspace_id, owner_id, company_id, scheduled_at, completed_at)
   values ($1,$2,$3,$4,'2026-10-21T10:00:00Z','2026-10-21T11:00:00Z')`,
  [randomUUID(), workspace, sam, northwind]
);
await db.query(
  `insert into public.upcoming_calls
   (id, workspace_id, owner_id, company_id, scheduled_at)
   values ($1,$2,$3,$4,'2026-12-09T10:00:00Z')`,
  [randomUUID(), workspace, sam, northwind]
);
await db.query(
  "insert into public.companies (id, workspace_id, owner_id, name, domain) values ($1,$2,$3,'Mailbox','gmail.com')",
  [gmailCompany, workspace, sam]
);
await db.query(
  "insert into public.companies (id, workspace_id, owner_id, name, domain) values ($1,$2,$3,'Internal Desk','ai13.com')",
  [internalCompany, workspace, sam]
);
await db.query(
  "insert into public.companies (id, workspace_id, owner_id, name, domain) values ($1,$2,$3,'Test Client Northstar','northstar.example')",
  [testCompany, workspace, sam]
);
await db.query(
  "insert into public.companies (id, workspace_id, owner_id, name, domain, is_confidential, notes) values ($1,$2,$3,'Quiet Ltd','quiet.example', true, 'SECRET_NOTE_SHOULD_NOT_LEAK')",
  [confidential, workspace, sam]
);
await db.query(
  `insert into public.crm_notifications
   (id, workspace_id, user_id, kind, title, source_table, source_id, source_event_key)
   values ($1,$2,$3,'important_email','Existing alert','companies',$4,'important_email:existing')`,
  [randomUUID(), workspace, owner, northwind]
);

async function asUser(userId, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

const check = `select * from public.lead_clash_check($1,$2,$3,$4,$5)`;
const off = await asUser(owner, check, [workspace, "Northwind College", "northwind.example", [], []]);
assert.equal(off.rows.length, 0, "the check stays empty until the switch is on");

await db.query(
  "insert into public.lead_clash_settings (workspace_id, enabled, updated_by) values ($1, true, $2)",
  [workspace, owner]
);

const ownRows = await asUser(owner, "select id, notes from public.companies");
assert.equal(ownRows.rows.length, 0, "RLS still hides another rep's companies");

const domainHit = await asUser(owner, check, [
  workspace,
  "Northwind College",
  "https://www.northwind.example/about",
  [],
  [],
]);
assert.equal(domainHit.rows.length, 1);
const hit = domainHit.rows[0];
assert.equal(hit.other_display_name, "Sam Rep");
assert.equal(hit.company_name, "Northwind College");
assert.equal(hit.contact_label, "Ada L.");
assert.equal(hit.match_type, "domain");
assert.equal(hit.last_touch_kind, "call");
assert.ok(hit.next_touch_at);
assert.equal(JSON.stringify(hit).includes("SECRET_NOTE_SHOULD_NOT_LEAK"), false);
assert.equal(JSON.stringify(hit).includes("ada@gmail.com"), false);
assert.deepEqual(Object.keys(hit).sort(), [
  "company_name",
  "confidential",
  "contact_label",
  "disposition",
  "last_touch_at",
  "last_touch_kind",
  "match_type",
  "match_value",
  "next_touch_at",
  "other_company_id",
  "other_display_name",
  "other_user_id",
].sort());

const person = await asUser(owner, check, [workspace, null, null, ["ada@gmail.com"], []]);
assert.equal(person.rows[0].match_type, "person");
assert.equal(person.rows[0].match_value, "email");
assert.equal(JSON.stringify(person.rows[0]).includes("ada@gmail.com"), false);

const linkedin = await asUser(owner, check, [
  workspace,
  null,
  null,
  [],
  ["https://www.linkedin.com/in/ada-example/"],
]);
assert.equal(linkedin.rows[0].match_type, "person");
assert.equal(linkedin.rows[0].match_value, "linkedin");

const freeMail = await asUser(owner, check, [workspace, null, "gmail.com", [], []]);
assert.equal(freeMail.rows.length, 0);

const internal = await asUser(owner, check, [workspace, null, "ai13.com", [], []]);
assert.equal(internal.rows.length, 0);

const testRecord = await asUser(owner, check, [workspace, "Test Client Northstar", "northstar.example", [], []]);
assert.equal(testRecord.rows.length, 0);

const shared = await asUser(
  owner,
  `select disposition from public.lead_clash_check($1,$2,$3,$4,$5,null,null,$6,$7)`,
  [workspace, "Northwind College", "northwind.example", [], [], owner, ["sam@example.test"]]
);
assert.equal(shared.rows[0].disposition, "shared");
assert.equal(rules.actionableClashes(rules.parseLeadClashMatches(shared.rows)).length, 0);

const hidden = await asUser(owner, check, [workspace, "Quiet Ltd", "quiet.example", [], []]);
assert.equal(hidden.rows[0].confidential, true);
assert.equal(hidden.rows[0].company_name, null);
assert.equal(hidden.rows[0].contact_label, null);
assert.equal(hidden.rows[0].other_display_name, "A colleague");
assert.equal(JSON.stringify(hidden.rows[0]).includes("SECRET_NOTE_SHOULD_NOT_LEAK"), false);

await assert.rejects(
  asUser(outsider, check, [workspace, "Northwind College", "northwind.example", [], []]),
  /lead_clash_not_a_member/
);

await db.exec("set role anon");
await assert.rejects(
  db.query(check, [workspace, "Northwind College", "northwind.example", [], []]),
  /permission denied|42501/i
);
await db.exec("reset role");

const salesUpdate = await asUser(
  sam,
  "update public.lead_clash_settings set enabled = false where workspace_id = $1 returning workspace_id",
  [workspace]
);
assert.equal(salesUpdate.rows.length, 0);
const stillOn = await db.query("select enabled from public.lead_clash_settings where workspace_id = $1", [workspace]);
assert.equal(stillOn.rows[0].enabled, true);

await db.query(
  `insert into public.crm_notifications
   (id, workspace_id, user_id, kind, title, source_table, source_id, source_event_key)
   values ($1,$2,$3,'lead_clash','Clash','lead_clashes',$4,'lead_clash:test')`,
  [randomUUID(), workspace, owner, northwind]
);

await db.exec("reset role");
await db.exec(down);

const gone = await db.query(
  "select to_regclass('public.lead_clash_settings') as settings, to_regclass('public.lead_clashes') as clashes, to_regprocedure('public.lead_clash_check(uuid,text,text,text[],text[],uuid,uuid,uuid,text[],text[],text[])') as fn"
);
assert.equal(gone.rows[0].settings, null);
assert.equal(gone.rows[0].clashes, null);
assert.equal(gone.rows[0].fn, null);
const surviving = await db.query("select name, notes from public.companies where id = $1", [northwind]);
assert.equal(surviving.rows[0].name, "Northwind College");
assert.equal(surviving.rows[0].notes, "SECRET_NOTE_SHOULD_NOT_LEAK");
const keptNotice = await db.query(
  "select count(*)::int as n from public.crm_notifications where kind = 'important_email'"
);
assert.equal(keptNotice.rows[0].n, 1);
const removedNotice = await db.query(
  "select count(*)::int as n from public.crm_notifications where kind = 'lead_clash'"
);
assert.equal(removedNotice.rows[0].n, 0);
await assert.rejects(
  db.query(
    `insert into public.crm_notifications
     (id, workspace_id, user_id, kind, title, source_table, source_id, source_event_key)
     values ($1,$2,$3,'lead_clash','Clash','companies',$4,'lead_clash:after-down')`,
    [randomUUID(), workspace, owner, northwind]
  ),
  /crm_notifications_kind_check|check constraint/i
);

console.log("Lead clash validation passed");
