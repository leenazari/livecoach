import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  ADAM_CAMPAIGN_SLUG,
  adamCompanyNotes,
  adamDraftFacts,
  adamHandoverFields,
  adamLinkedinKey,
  adamOutboundPlaybook,
  adamSheetNote,
  adamSheetStatusLabel,
  adamSheetsBlocker,
  decideAdamLead,
  findAdamSheetRow,
  mergeStoredPlaybook,
  nextAdamProspectStatus,
  parseAdamSheet,
  prospectMatchesCampaignFilter,
  prospectStatusFromSheet,
  validateAdamDraft,
  matchAdamOwner,
} from "../lib/adam-outbound.ts";
import { readAdamSheet, writeAdamSheetCells } from "../lib/adam-sheet.ts";

const playbook = adamOutboundPlaybook();
assert.equal(playbook.kind, "adam_outbound");
assert.equal(playbook.version, 1);
assert.match(playbook.emailPrompt, /one measurable number/);
assert.match(playbook.emailPrompt, /120 words/);
assert.match(playbook.emailPrompt, /demo link/);
assert.match(playbook.emailPrompt, /success number/);
assert.match(playbook.emailPrompt, /one line/);
assert.match(playbook.emailPrompt, /Never invent figures/);
assert.match(playbook.emailPrompt, /decision maker/);
assert.match(playbook.product.price, /£99/);
assert.equal(playbook.emailRules.maxWords, 120);
assert.equal(mergeStoredPlaybook({ version: 0, sheet: { tab: "Leads" } }).emailPrompt, playbook.emailPrompt);
assert.equal(mergeStoredPlaybook({ version: 1, emailPrompt: "Custom prompt that is long enough to stay." }).emailPrompt, "Custom prompt that is long enough to stay.");

const header = ["date", "company", "website", "contact", "role", "LinkedIn URL", "signal", "signal link", "why Adam fits", "suggested opener", "status", "owner", "notes", "Phone number", "Email address", "demo link", "email subject", "email body", "page status", "decision maker email", "email source", "DM email subject", "DM email body"];
const row = ["2026-11-09", "Northwind", "https://www.northwind.example", "Ada Lovelace", "Owner", "https://www.linkedin.com/in/ada/", "Hiring a receptionist", "https://northwind.example/jobs", "Missed calls are up 30 percent", "They need a greeter", "new", "Kamm", "", "01234567890", "hello@northwind.example", "https://demo.example/northwind", "Subject", "Body", "ready to email", "ada@northwind.example", "website", "DM subject", "DM body"];
const parsed = parseAdamSheet([header, row, ["", "Second Co", "second.example", "Grace Hopper", "Founder", "", "New menu", "", "No measured figure yet", "", "", "Sharon", "", "", "info@second.example", "", "", "", "building", "", "", "", ""]]);
assert.equal(parsed.headerSkipped, true);
assert.equal(parsed.leads.length, 2);
assert.equal(parsed.leads[0].rowNumber, 2);
assert.equal(parsed.leads[0].domain, "northwind.example");
assert.equal(parsed.leads[0].generalEmail, "hello@northwind.example");
assert.equal(parsed.leads[0].decisionMakerEmail, "ada@northwind.example");
assert.equal(parsed.leads[0].firstName, "Ada");
assert.equal(parsed.leads[0].linkedinKey, "linkedin.com/in/ada");
assert.equal(adamLinkedinKey("HTTPS://WWW.LinkedIn.com/in/ada/?trk=1"), "linkedin.com/in/ada");

const members = [
  { userId: "kamm", name: "Kamm Smith" },
  { userId: "sharon", name: "Sharon Jones" },
  { userId: "nikhara", name: "Nikhara" },
  { userId: "lee", name: "Lee Nazari" },
];
assert.equal(matchAdamOwner("Kamm", members).userId, "kamm");
assert.equal(matchAdamOwner("sharon", members).userId, "sharon");
assert.equal(matchAdamOwner("Nikhara", members).userId, "nikhara");
assert.equal(matchAdamOwner("Lee", members).userId, "lee");
assert.equal(matchAdamOwner("Pat", members).userId, null);
assert.equal(matchAdamOwner("Sam", [{ userId: "a", name: "Sam One" }, { userId: "b", name: "Sam Two" }]).ambiguous, true);

const actor = { userId: "kamm", role: "sales" };
const baseInput = {
  actor,
  members,
  prospects: [],
  contactEmails: new Set(),
  blockedDomains: new Set(),
  sendpilot: [],
  clashes: [],
  seenEmails: new Set(),
  campaignId: "adam-campaign",
};

const fresh = decideAdamLead({ ...baseInput, lead: parsed.leads[0] });
assert.equal(fresh.skip, false);
assert.equal(fresh.assignedToUserId, "kamm");
assert.deepEqual(fresh.audiences.map((item) => item.audience), ["general_inbox", "decision_maker"]);
assert.equal(fresh.audiences.every((item) => item.action === "create" && !item.hold), true);

const otherOwner = decideAdamLead({ ...baseInput, lead: parsed.leads[1] });
assert.equal(otherOwner.skip, true);
assert.match(otherOwner.skipReason, /Sharon/);

const manager = decideAdamLead({
  ...baseInput,
  actor: { userId: "lee", role: "owner" },
  lead: parsed.leads[1],
});
assert.equal(manager.skip, false);
assert.equal(manager.assignedToUserId, "sharon");

const sendpilotHeld = decideAdamLead({
  ...baseInput,
  lead: parsed.leads[0],
  sendpilot: [{ matchType: "linkedin", syncStatus: "active", ownerName: "Sharon" }],
});
assert.equal(sendpilotHeld.audiences[0].hold.code, "sendpilot");
assert.match(sendpilotHeld.audiences[0].hold.reason, /Sharon/);

const contactHeld = decideAdamLead({
  ...baseInput,
  lead: parsed.leads[0],
  contactEmails: new Set(["ada@northwind.example"]),
});
assert.equal(contactHeld.audiences.find((item) => item.email === "ada@northwind.example").hold.code, "existing_contact");
assert.equal(contactHeld.audiences.find((item) => item.email === "hello@northwind.example").hold, null);

const companyHeld = decideAdamLead({
  ...baseInput,
  lead: parsed.leads[0],
  blockedDomains: new Set(["northwind.example"]),
});
assert.equal(companyHeld.hold.code, "crm_company");

const clashHeld = decideAdamLead({
  ...baseInput,
  lead: parsed.leads[0],
  clashes: [{ displayName: "Alex Owner", matchType: "domain" }],
});
assert.equal(clashHeld.hold.code, "lead_clash");
assert.match(clashHeld.hold.reason, /Alex Owner/);

const sentHeld = decideAdamLead({
  ...baseInput,
  lead: { ...parsed.leads[0], pageStatus: "sent" },
});
assert.equal(sentHeld.hold.code, "already_contacted_on_sheet");
const liveHeld = decideAdamLead({
  ...baseInput,
  lead: { ...parsed.leads[0], pageStatus: "live" },
});
assert.equal(liveHeld.hold.code, "already_contacted_on_sheet");
assert.match(liveHeld.hold.reason, /live/);

const extraHeader = [...header, "Sector", "Company size", "Location", "Business description", "Company LinkedIn URL"];
const extraRow = [...row, "Hospitality", "11-50", "York, UK", "A seaside hotel.", "https://www.linkedin.com/company/northwind"];
const extra = parseAdamSheet([extraHeader, extraRow]);
assert.equal(extra.leads[0].sector, "Hospitality");
assert.equal(extra.leads[0].companySize, "11-50");
assert.equal(extra.leads[0].city, "York");
assert.equal(extra.leads[0].country, "UK");
assert.equal(extra.leads[0].businessDescription, "A seaside hotel.");
assert.equal(extra.leads[0].companyLinkedIn, "https://www.linkedin.com/company/northwind");
assert.equal(extra.leads[0].domain, "northwind.example");
const oldSheet = parseAdamSheet([header, row]);
assert.equal(oldSheet.leads[0].sector, null);
assert.equal(oldSheet.leads[0].businessDescription, null);

const handover = adamHandoverFields({
  company_name: "Northwind",
  company_domain: "northwind.example",
  website: "https://northwind.example",
  industry: "Hospitality",
  employee_range: "11-50",
  city: "York",
  country: "UK",
  company_linkedin_url: "https://www.linkedin.com/company/northwind",
  phone: "01234567890",
  person_linkedin_url: "https://www.linkedin.com/in/ada",
  job_title: "Owner",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@northwind.example",
  source_metadata: {
    business_description: "A seaside hotel.",
    why_adam_fits: "Missed calls are up 30 percent",
    signal: "Hiring a receptionist",
    demo_link: "https://demo.example/northwind",
  },
});
assert.equal(handover.company.sector, "Hospitality");
assert.equal(handover.company.stage, "Discovery");
assert.equal(handover.company.profile.source, "Adam outbound");
assert.equal(handover.company.profile.employeeRange, "11-50");
assert.equal(handover.company.profile.location, "York, UK");
assert.match(handover.company.notes, /Why Adam fits/);
assert.match(adamCompanyNotes({ source_metadata: handover ? {
  business_description: "A seaside hotel.",
  why_adam_fits: "Missed calls are up 30 percent",
  signal: "Hiring a receptionist",
  demo_link: "https://demo.example/northwind",
} : {} }), /Demo:/);
assert.equal(handover.contact.attributes.source, "Adam outbound");
assert.equal(handover.contact.attributes.phone, "01234567890");
assert.equal(handover.opportunity.pipelineStage, "discovery");
assert.equal(handover.opportunity.source, "Adam outbound");
const promoted = readFileSync(new URL("../lib/outreach-crm.ts", import.meta.url), "utf8");
assert.match(promoted, /adamHandoverFields/);
assert.match(promoted, /createCanonicalOpenRevenueOpportunity/);

const existing = decideAdamLead({
  ...baseInput,
  lead: parsed.leads[0],
  prospects: [{
    id: "prospect-1",
    email: "hello@northwind.example",
    status: "imported",
    activeEnrolmentCampaignId: "other-campaign",
  }],
});
assert.equal(existing.audiences[0].action, "update");
assert.equal(existing.audiences[0].hold.code, "active_outreach");

const seen = new Set(["hello@northwind.example"]);
const duplicate = decideAdamLead({ ...baseInput, lead: parsed.leads[0], seenEmails: seen });
assert.equal(duplicate.audiences[0].action, "skip");
assert.equal(duplicate.audiences[0].hold.code, "duplicate_in_sheet");

assert.equal(prospectStatusFromSheet("pipeline negotiation"), null);
assert.equal(prospectStatusFromSheet("verbal"), null);
assert.equal(prospectStatusFromSheet("replied"), "replied");
assert.equal(nextAdamProspectStatus("replied", "new"), "replied");
assert.equal(nextAdamProspectStatus("contacted", "qualified"), "qualified");
assert.equal(adamSheetStatusLabel("replied"), "Replied");
assert.equal(adamSheetStatusLabel("qualified"), "Qualified");
assert.equal(adamSheetStatusLabel("suppressed"), "Do not contact");
assert.equal(adamSheetStatusLabel("contacted"), null);
assert.equal(adamSheetStatusLabel("negotiation"), null);
assert.match(adamSheetNote("Old note", "Asked for Friday", "2026-11-09T12:00:00.000Z"), /CRM 2026-11-09: Asked for Friday/);
assert.equal(findAdamSheetRow([header, row], ["ada@northwind.example"]).rowNumber, 2);
assert.equal(findAdamSheetRow([header, row, row], ["ada@northwind.example"]).ambiguous, true);

const goodBody = "Northwind missed calls are up 30 percent, and the hiring signal shows a receptionist gap. Adam can greet visitors from https://demo.example/northwind. We can agree one success number before a trial and report it weekly. Setup is one line. If this is not relevant, I will not follow up.";
const good = validateAdamDraft({
  audience: "decision_maker",
  subject: "Ada, a greeter for Northwind",
  body: `Hi Ada. ${goodBody}`,
  firstName: "Ada",
  demoLink: "https://demo.example/northwind",
  whyAdamFits: "Missed calls are up 30 percent",
  allowedFacts: "Missed calls are up 30 percent\n£99 per month including about 350 minutes, then £0.35 per minute\nhttps://demo.example/northwind",
  rules: playbook.emailRules,
});
assert.equal(good.ok, true, good.problems.join(" "));

const invented = validateAdamDraft({
  audience: "general_inbox",
  subject: "A greeter for Northwind",
  body: `${goodBody.replace("30", "80")} Hello there.`,
  firstName: "Ada",
  demoLink: "https://demo.example/northwind",
  whyAdamFits: "Missed calls are up 30 percent",
  allowedFacts: "Missed calls are up 30 percent\nhttps://demo.example/northwind",
  rules: playbook.emailRules,
});
assert.equal(invented.ok, false);
assert.match(invented.problems.join(" "), /figure/);

const tooLong = validateAdamDraft({
  audience: "general_inbox",
  subject: "Hello",
  body: `${Array.from({ length: 130 }, () => "word").join(" ")} If this is not relevant, I will not follow up.`,
  demoLink: null,
  whyAdamFits: "",
  allowedFacts: "",
  rules: { ...playbook.emailRules, requireDemoLink: false, requireMeasurableNumber: false },
});
assert.equal(tooLong.ok, false);
assert.match(tooLong.problems.join(" "), /120/);

assert.match(adamDraftFacts({ audience: "decision_maker", lead: parsed.leads[0], senderFirstName: "Kamm" }), /Why Adam fits/);
assert.equal(prospectMatchesCampaignFilter({ source_metadata: { adam_campaign_id: "adam-campaign" } }, "adam-campaign"), true);
assert.equal(prospectMatchesCampaignFilter({ outreach: { campaignIds: [] } }, "adam-campaign"), false);
assert.match(adamSheetsBlocker("sheets_scope").nextAction, /Google Cloud OAuth client/);
assert.doesNotMatch(adamSheetsBlocker("sheets_scope").nextAction, /service account key/i);

const calls = [];
const read = await readAdamSheet({
  accessToken: "token",
  spreadsheetId: "sheet",
  tab: "Leads",
  fetchImpl: async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ values: [header, row] }), { status: 200 });
  },
});
assert.equal(read.ok, true);
assert.match(calls[0], /spreadsheets\/sheet\/values/);
const denied = await readAdamSheet({
  accessToken: "token",
  spreadsheetId: "sheet",
  tab: "Leads",
  fetchImpl: async () => new Response("no", { status: 403 }),
});
assert.equal(denied.ok, false);
assert.equal(denied.code, "sheets_access");
let wrote = null;
const write = await writeAdamSheetCells({
  accessToken: "token",
  spreadsheetId: "sheet",
  tab: "Leads",
  rowNumber: 2,
  status: "Replied",
  note: "CRM 2026-11-09: Asked for Friday",
  fetchImpl: async (_url, init) => {
    wrote = JSON.parse(init.body);
    return new Response("{}", { status: 200 });
  },
});
assert.equal(write.ok, true);
assert.equal(wrote.data[0].values[0][0], "Replied");
assert.match(wrote.data[0].range, /K2/);
assert.match(wrote.data[1].range, /M2/);

const migration = readFileSync(new URL("../supabase/migrations/20261109120000_adam_outbound_campaign.sql", import.meta.url), "utf8");
assert.match(migration, /adam_daily_leads/);
assert.match(migration, /adam_sendpilot_touches/);
assert.match(migration, /not applied by the pull request/i);
assert.doesNotMatch(migration, /marketing_leads/);
assert.doesNotMatch(migration, /new-leads/);
const google = readFileSync(new URL("../lib/google.ts", import.meta.url), "utf8");
assert.match(google, /GOOGLE_SHEETS_SCOPE/);
assert.doesNotMatch(google.slice(google.indexOf("const SCOPE"), google.indexOf("export function googleConfigured")), /spreadsheets/);
const prepare = readFileSync(new URL("../app/api/crm/outreach/[id]/prepare/route.ts", import.meta.url), "utf8");
assert.match(prepare, /adam_daily_leads/);
const replies = readFileSync(new URL("../lib/outreach-replies.ts", import.meta.url), "utf8");
assert.match(replies, /writeAdamReplyStatus/);
const emailSweep = readFileSync(new URL("../app/api/crm/email-sweep/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(emailSweep, /adam-outbound/);
const sendQueue = readFileSync(new URL("../lib/outreach-send-queue.ts", import.meta.url), "utf8");
assert.match(sendQueue, /adamSendBlockReason/);
const page = readFileSync(new URL("../app/crm/outreach/page.tsx", import.meta.url), "utf8");
assert.match(page, /AdamOutboundPanel/);
assert.doesNotMatch(page, /marketing_leads/);

const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
  create table public.workspace_members (workspace_id uuid, user_id uuid, status text, role text, created_at timestamptz default now());
  create table public.profiles (user_id uuid primary key, display_name text);
  create table public.sendpilot_lead_links (
    workspace_id uuid,
    owner_id uuid,
    linkedin_url text,
    email text,
    sync_status text
  );
`);
const functionSql = migration.slice(
  migration.indexOf("create or replace function public.adam_linkedin_key"),
  migration.indexOf("revoke all on function public.adam_linkedin_key")
);
await db.exec(functionSql);
const workspace = "22222222-2222-4222-8222-222222222222";
const otherWorkspace = "33333333-3333-4333-8333-333333333333";
const sharon = "44444444-4444-4444-8444-444444444444";
const kamm = "11111111-1111-4111-8111-111111111111";
await db.query("insert into public.workspace_members (workspace_id, user_id, status, role) values ($1,$2,'active','sales')", [workspace, kamm]);
await db.query("insert into public.profiles (user_id, display_name) values ($1,'Sharon Jones')", [sharon]);
await db.query(
  "insert into public.sendpilot_lead_links (workspace_id, owner_id, linkedin_url, email, sync_status) values ($1,$2,$3,$4,'active'), ($1,$2,'https://www.linkedin.com/in/failed/', 'failed@northwind.example','failed'), ($5,$2,'https://www.linkedin.com/in/other/','other@example.com','active')",
  [workspace, sharon, "https://www.linkedin.com/in/ada/?trk=public", "ada@northwind.example", otherWorkspace]
);
const linkedinHit = await db.query(
  "select match_type, match_value, sync_status, owner_display_name from public.adam_sendpilot_touches($1::uuid, $2::text[], $3::text[])",
  [workspace, [], ["https://linkedin.com/in/ada"]]
);
assert.equal(linkedinHit.rows.length, 1);
assert.equal(linkedinHit.rows[0].match_type, "linkedin");
assert.equal(linkedinHit.rows[0].owner_display_name, "Sharon Jones");
const failedHit = await db.query(
  "select match_type from public.adam_sendpilot_touches($1::uuid, $2::text[], $3::text[])",
  [workspace, ["failed@northwind.example"], []]
);
assert.equal(failedHit.rows.length, 0);
const otherHit = await db.query(
  "select match_type from public.adam_sendpilot_touches($1::uuid, $2::text[], $3::text[])",
  [workspace, ["other@example.com"], ["https://www.linkedin.com/in/other/"]]
);
assert.equal(otherHit.rows.length, 0);
await assert.rejects(
  db.exec("select * from public.adam_sendpilot_touches('55555555-5555-4555-8555-555555555555'::uuid, array[]::text[], array[]::text[])"),
  /adam_sendpilot_touch_forbidden/
);

console.log("Adam outbound checks passed. Sheet parsing, dedupe, draft rules, Sheets opt-in and SendPilot match verified. No email was sent.");
