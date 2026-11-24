import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const qaDir = process.env.SALES_UI_QA_DIR;
let qaCss = '';
function load(path, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : name in deps ? deps[name] : require(name), module, module.exports);
  return module.exports;
}
if (qaDir) {
  const resolved = realpathSync(qaDir);
  assert.ok(resolved.startsWith('/private/tmp/livecoach-sales-qa.') || resolved.startsWith('/tmp/livecoach-sales-qa.'));
  assert.ok(lstatSync(qaDir).isDirectory() && !lstatSync(qaDir).isSymbolicLink());
  qaCss = (await require('postcss')([require('tailwindcss')(load('tailwind.config.ts').default)]).process(readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' })).css;
}
function snapshot(name) {
  if (!qaDir) return;
  writeFileSync(path.join(qaDir, `${name}.html`), `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${qaCss}</style></head><body class="bg-ink text-bone font-sans">${document.getElementById('root').innerHTML}</body></html>`);
}
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let actor = { userId: 'kam', workspaceId: 'w', role: 'owner' }, failTable = '', reads = [];
const base = { workspace_id: 'w', owner_id: 'kam', company_id: COMPANY };
const db = {
  workspace_members: ['kam', 'sharon', 'lee'].map(user_id => ({ workspace_id: 'w', user_id, role: user_id === 'lee' ? 'owner' : 'sales', status: 'active' })),
  outreach_messages: [
    { ...base, id: 'sent', sender_user_id: 'kam', status: 'sent', subject: 'Demo follow-up', recipient_email: 'buyer@example.test', sent_at: '2026-11-23T12:00:00Z', gmail_message_id: 'provider-one', body_text: 'Thanks for the demo. <script>alert(1)</script>', outreach_prospects: { workspace_id: 'w', crm_company_id: COMPANY } },
  ],
  email_assistant_drafts: [
    { ...base, id: 'assistant', status: 'sent', draft_subject: 'Your proposal', recipient_email: 'buyer@example.test', sent_at: '2026-11-24T12:00:00Z', provider_message_id: 'provider-two', draft_body: 'Here is your proposal.' },
  ],
  client_context: [
    { ...base, id: 'reply', kind: 'email_reply', title: 'Saved reply', created_at: '2026-11-24T13:01:00Z', source_ref: 'google:reply-one', metadata: { receivedAt: '2026-11-24T13:00:00Z', senderEmail: 'buyer@example.test', subject: 'Friday works', secret: 'HIDDEN_METADATA' }, content: 'Friday works for us.' },
  ],
};
const ownOutreach = db.outreach_messages[0], ownDraft = db.email_assistant_drafts[0], ownReply = db.client_context[0];
db.outreach_messages.push(
  { ...ownOutreach, id: 'sharon', sender_user_id: 'sharon', body_text: 'HIDDEN_SHARON' },
  { ...ownOutreach, id: 'foreign', workspace_id: 'foreign', body_text: 'HIDDEN_FOREIGN' },
  { ...ownOutreach, id: 'foreign-join', outreach_prospects: { workspace_id: 'foreign', crm_company_id: COMPANY }, body_text: 'HIDDEN_JOIN' },
  { ...ownOutreach, id: 'other-company', outreach_prospects: { workspace_id: 'w', crm_company_id: OTHER }, body_text: 'HIDDEN_OTHER_COMPANY' },
  { ...ownOutreach, id: 'draft', status: 'draft', body_text: 'HIDDEN_UNSENT' },
  { ...ownOutreach, id: 'unconfirmed', sent_at: null, body_text: 'HIDDEN_UNCONFIRMED' },
);
db.email_assistant_drafts.push(
  { ...ownDraft, id: 'duplicate', provider_message_id: 'provider-one', draft_body: 'Duplicate send receipt' },
  { ...ownDraft, id: 'lee', owner_id: 'lee', draft_body: 'HIDDEN_LEE' },
  { ...ownDraft, id: 'queued', status: 'approved', draft_body: 'HIDDEN_UNSENT' },
  { ...ownDraft, id: 'foreign', workspace_id: 'foreign', draft_body: 'HIDDEN_FOREIGN' },
);
db.client_context.push(
  { ...ownReply, id: 'lee', owner_id: 'lee', content: 'HIDDEN_LEE' },
  { ...ownReply, id: 'note', kind: 'note', content: 'HIDDEN_NOT_AN_EMAIL' },
  { ...ownReply, id: 'other-company', company_id: OTHER, content: 'HIDDEN_OTHER_COMPANY' },
);
const field = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
class Query {
  constructor(table) { this.table = table; this.filters = []; this.max = Infinity; }
  select(fields) { assert.ok(!fields.includes('*')); this.fields = fields; return this; }
  eq(key, value) { this.filters.push(row => field(row, key) === value); return this; }
  in(key, values) { this.filters.push(row => values.includes(field(row, key))); return this; }
  not(key, op, value) { assert.equal(op, 'is'); assert.equal(value, null); this.filters.push(row => row[key] != null); return this; }
  order(key, options) { this.sortKey = key; this.ascending = options.ascending; return this; }
  limit(value) { assert.ok(value <= 100); this.max = value; return this; }
  abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; }
  returns() { return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve, reject) {
    reads.push({ table: this.table, fields: this.fields });
    const rows = db[this.table].filter(row => this.filters.every(filter => filter(row)));
    if (this.sortKey) rows.sort((a, b) => String(a[this.sortKey]).localeCompare(String(b[this.sortKey])) * (this.ascending ? 1 : -1));
    return Promise.resolve({ data: this.single ? rows[0] || null : rows.slice(0, this.max), error: this.table === failTable ? new Error('PRIVATE_DATABASE_ERROR') : null }).then(resolve, reject);
  }
}
const dbClient = { from: table => new Query(table) };
const json = (data, options) => ({ data, ...options });
const blocker = { crmBlockerPayload: value => ({ error: value.title, blocker: value }) };
const scope = load('lib/sales-lead-service.ts', { '@/lib/supabase': { supabaseService: dbClient }, '@/lib/request-scope': { requireRequestScope: () => actor }, '@/lib/crm-blocker': blocker, 'next/server': { NextResponse: { json } } });
const server = load('lib/recorded-company-emails-server.ts', { '@/lib/supabase': { supabaseAdmin: dbClient }, '@/lib/sales-lead-service': scope });
let history = await server.loadRecordedCompanyEmails([COMPANY], true);
assert.deepEqual(history.messages.map(message => message.id), ['reply-reply', 'assistant-assistant', 'outreach-sent']);
assert.doesNotMatch(JSON.stringify(history), /HIDDEN_|workspace_id|owner_id|source_ref|provider-one/);
assert.equal(history.messages[0].text, 'Friday works for us.');
assert.equal(history.limited, false);
reads = [];
history = await server.loadRecordedCompanyEmails([COMPANY]);
assert.ok(history.messages.every(message => !('text' in message)));
assert.ok(reads.every(read => !/body_text|draft_body|,content/.test(read.fields)), 'List preview never selects bodies');
actor.userId = 'sharon';
assert.equal((await server.loadRecordedCompanyEmails([COMPANY], true)).messages.length, 1);
assert.match(JSON.stringify(await server.loadRecordedCompanyEmails([COMPANY], true)), /HIDDEN_SHARON/);
actor.userId = 'lee';
history = await server.loadRecordedCompanyEmails([COMPANY], true);
assert.ok(history.messages.every(message => !['outreach-sent', 'assistant-assistant', 'reply-reply'].includes(message.id)), 'Owner role does not expand mailbox access');
actor.userId = 'kam';
for (const status of ['removed', 'suspended', 'onboarding']) {
  db.workspace_members[0].status = status; reads = [];
  await assert.rejects(server.loadRecordedCompanyEmails([COMPANY]), /sales_lead_access/);
  assert.deepEqual(reads.map(read => read.table), ['workspace_members']);
}
db.workspace_members[0].status = 'active'; actor.workspaceId = 'foreign';
await assert.rejects(server.loadRecordedCompanyEmails([COMPANY]), /sales_lead_access/);
actor.workspaceId = 'w';
await assert.rejects(server.loadRecordedCompanyEmails(Array.from({ length: 26 }, (_, i) => String(i))), /too_large/);
for (const table of ['outreach_messages', 'email_assistant_drafts', 'client_context']) {
  failTable = table; await assert.rejects(server.loadRecordedCompanyEmails([COMPANY]), /PRIVATE_DATABASE_ERROR/);
}
failTable = '';
const original = db.client_context;
db.client_context = Array.from({ length: 101 }, (_, i) => ({ ...ownReply, id: `r${i}`, source_ref: `google:r${i}`, content: 'x'.repeat(8100) }));
history = await server.loadRecordedCompanyEmails([COMPANY], true);
assert.equal(history.limited, true); assert.equal(history.messages.find(message => message.direction === 'received').text.length, 8000);
assert.equal(history.messages.find(message => message.direction === 'received').truncated, true);
db.client_context = original;

let companyAccess = true;
let mailboxCalls = [];
const route = load('app/api/crm/companies/[id]/emails/route.ts', {
  'next/server': { NextResponse: { json } }, '@/lib/crm-blocker': blocker, '@/lib/sales-lead-service': scope,
  '@/lib/recorded-company-emails-server': server, '@/lib/assigned-client-access': { loadAssignedClientAccess: async id => companyAccess && id === COMPANY ? { mode: 'shared_sales' } : null },
  '@/lib/lead-mailbox-history': { loadLeadMailboxHistory: async id => { mailboxCalls.push(id); return { messages: [], limited: true }; } },
});
const get = (id, query = '') => route.GET({ url: `https://crm.test/api/crm/companies/${id}/emails${query}` }, { params: { id } });
assert.equal((await get('invalid')).status, 400);
assert.equal((await get(COMPANY, '?source=unknown')).status, 400);
assert.equal((await get(OTHER)).status, 403);
companyAccess = false; reads = [];
assert.equal((await get(COMPANY)).status, 403);
assert.ok(reads.every(read => read.table === 'workspace_members'), 'Denied companies must not trigger any email lookup');
companyAccess = true;
assert.equal((await get(COMPANY)).headers['Cache-Control'], 'private, no-store');
assert.equal(mailboxCalls.length, 0);
await get(COMPANY, '?source=mailbox&email=not-the-contact@example.test');
assert.deepEqual(mailboxCalls, [COMPANY], 'Mailbox route accepts a company ID, never a caller-supplied email');
failTable = 'client_context';
const failed = await get(COMPANY);
assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_DATABASE_ERROR/);
failTable = '';
db.workspace_members[0].status = 'removed'; assert.equal((await get(COMPANY)).status, 403); db.workspace_members[0].status = 'active';

// Connected mailbox lookup is explicit, address-exact and always uses the actor.
let canonicalEmail = 'buyer@example.test', mailboxProvider = 'google', assignedVisible = true;
let mailboxOwnerCalls = [];
const mailMessage = { id: 'mail-one', date: '2026-11-24T12:00:00Z', from: 'Kamm <kam@example.test>', to: 'Buyer <buyer@example.test>', cc: '', subject: 'Current demo', snippet: 'Here is the demo', labelIds: ['SENT'] };
const providerLookup = async (query, max, owner, options) => {
  mailboxOwnerCalls.push(owner); assert.equal(owner, actor.userId); assert.equal(max, 12);
  assert.equal(query, '(from:buyer@example.test OR to:buyer@example.test)'); assert.equal(options.strict, true);
  if (mailboxProvider === 'microsoft') assert.equal(options.exactContactEmail, 'buyer@example.test');
  return [mailMessage,
    { ...mailMessage, id: 'received', from: 'Buyer <buyer@example.test>', to: 'kam@example.test', labelIds: ['INBOX'] },
    { ...mailMessage, id: 'wrong', to: 'not-buyer@example.test' },
    { ...mailMessage, id: 'domain', to: 'buyer@example.test.evil.test' },
    { ...mailMessage, id: 'draft', labelIds: ['DRAFT'] },
    { ...mailMessage, id: 'unrelated-cc', from: 'other@example.test', labelIds: ['INBOX'] },
  ];
};
const mailbox = load('lib/lead-mailbox-history.ts', {
  '@/lib/sales-lead-service': scope,
  '@/lib/assigned-new-leads-server': { loadAssignedNewLeads: async id => ({ leads: assignedVisible ? [{ id, email: canonicalEmail }] : [] }) },
  '@/lib/mail': { connectedMailProvider: async owner => { assert.equal(owner, actor.userId); return { provider: mailboxProvider, email: 'kam@example.test' }; } },
  '@/lib/gmail': { recentMessages: providerLookup }, '@/lib/microsoft': { recentMicrosoftMessages: providerLookup },
});
for (const provider of ['google', 'microsoft']) {
  mailboxProvider = provider;
  const found = await mailbox.loadLeadMailboxHistory(COMPANY);
  assert.deepEqual(found.messages.map(message => message.id), [`mailbox-${provider}-mail-one`, `mailbox-${provider}-received`]);
  assert.ok(found.limited); assert.equal(found.matchedEmail, canonicalEmail);
}
actor.userId = 'sharon'; await mailbox.loadLeadMailboxHistory(COMPANY); assert.equal(mailboxOwnerCalls.at(-1), 'sharon'); actor.userId = 'kam';
assignedVisible = false; const callsBeforeDenied = mailboxOwnerCalls.length;
await assert.rejects(mailbox.loadLeadMailboxHistory(COMPANY), /sales_lead_access/); assert.equal(mailboxOwnerCalls.length, callsBeforeDenied); assignedVisible = true;
for (const email of ['', 'kam@example.test', 'buyer@example.test OR from:private@example.test']) {
  canonicalEmail = email; await assert.rejects(mailbox.loadLeadMailboxHistory(COMPANY), /mailbox_contact_missing/);
}
canonicalEmail = 'buyer@example.test'; mailboxProvider = null;
await assert.rejects(mailbox.loadLeadMailboxHistory(COMPANY), /mailbox_not_connected/); mailboxProvider = 'google';

// Strict provider reads distinguish empty results from failure. Existing callers
// keep their previous best-effort contract unless they opt into strict reads.
const originalFetch = globalThis.fetch;
let mailResponse = 'empty';
const google = load('lib/gmail.ts', { '@/lib/google': { getAccessToken: async (_force, owner) => { assert.equal(owner, 'kam'); return 'test-token'; }, googleConnected: async () => ({ connected: true }) } });
globalThis.fetch = async url => {
  if (mailResponse === 'failure') return new Response('', { status: 503 });
  if (mailResponse === 'network') throw new Error('Network unavailable');
  if (mailResponse === 'empty') return Response.json({ resultSizeEstimate: 0 });
  if (mailResponse === 'malformed') return Response.json({});
  if (String(url).includes('/messages?')) return Response.json({ messages: [{ id: 'a' }] });
  return new Response('', { status: 503 });
};
assert.deepEqual(await google.recentMessages('from:buyer@example.test', 12, 'kam', { strict: true }), []);
for (const scenario of ['failure', 'network', 'malformed', 'partial']) {
  mailResponse = scenario; await assert.rejects(google.recentMessages('from:buyer@example.test', 12, 'kam', { strict: true }), /mailbox_search_unavailable/);
}
mailResponse = 'failure'; assert.deepEqual(await google.recentMessages('from:buyer@example.test', 12, 'kam'), []);
const microsoftDb = { from(table) { assert.equal(table, 'microsoft_oauth'); const q = { select() { return q; }, eq(key, value) { assert.equal(key, 'owner_id'); assert.equal(value, 'kam'); return q; }, limit() { return q; }, async maybeSingle() { return { data: { id: 'connection', owner_id: 'kam', refresh_token: 'test-refresh', access_token: 'test-token', expiry: '2099-01-01T00:00:00Z' }, error: null }; } }; return q; } };
const microsoft = load('lib/microsoft.ts', {
  '@/lib/request-scope': { getRequestScope: () => actor, isVerifiedServiceRequest: () => false }, '@/lib/service-scope': { getServiceRecordScope: () => null },
  '@/lib/supabase': { supabaseService: microsoftDb }, '@/lib/calendar-create': {}, '@/lib/gmail': google,
});
await assert.rejects(microsoft.recentMicrosoftMessages('from:buyer@example.test', 12, 'kam', { strict: true }), /mailbox_search_unavailable/);
assert.deepEqual(await microsoft.recentMicrosoftMessages('from:buyer@example.test', 12, 'kam'), []);
globalThis.fetch = async () => Response.json({ value: [] });
assert.deepEqual(await microsoft.recentMicrosoftMessages('from:buyer@example.test', 12, 'kam', { strict: true }), []);
let graphSearch;
globalThis.fetch = async url => {
  graphSearch = new URL(url).searchParams;
  const message = { id: 'matching', isDraft: false, receivedDateTime: '2026-11-24T12:00:00Z', from: { emailAddress: { address: 'buyer@example.test' } }, toRecipients: [{ emailAddress: { address: 'kam@example.test' } }], subject: 'Mailbox search result', bodyPreview: 'The saved preview' };
  return Response.json({ value: [message, { ...message, id: 'unsent', isDraft: true }, { ...message, id: 'unknown-status', isDraft: undefined }] });
};
const graphResults = await microsoft.recentMicrosoftMessages('(from:buyer@example.test OR to:buyer@example.test)', 12, 'kam', { strict: true, exactContactEmail: 'buyer@example.test' });
assert.equal(graphSearch.get('$search'), '"from:buyer@example.test OR to:buyer@example.test"');
assert.equal(graphSearch.has('$orderby'), false);
assert.match(graphSearch.get('$select'), /isDraft/);
assert.deepEqual(graphResults.map(message => message.id), ['matching']);
await assert.rejects(microsoft.recentMicrosoftMessages('', 12, 'kam', { strict: true, exactContactEmail: 'buyer@example.test OR from:private@example.test' }), /mailbox_contact_missing/);
globalThis.fetch = originalFetch;

const projection = load('lib/assigned-new-leads.ts');
const navigation = load('lib/lead-list-navigation.ts', { '@/lib/assigned-new-leads': projection });
const saved = { ...navigation.defaultLeadListFilters, page: 3, query: 'Example & Co', status: 'contacted', sort: 'oldest' };
const params = navigation.writeLeadListFilters(new URLSearchParams('inbound=1'), saved);
assert.equal(params.get('inbound'), '1'); assert.deepEqual(navigation.readLeadListFilters(params), saved);
assert.deepEqual(navigation.readLeadListFilters(new URLSearchParams('lead_page=-1&lead_sort=bad&lead_owner=bad&lead_status=bad')), navigation.defaultLeadListFilters);
const search = load('lib/pipeline-search.ts');
assert.equal(search.matchesPipelineSearch({ company: 'Café Example', title: 'Adam trial', next_action: 'Book demo' }, 'example café'), true);
assert.equal(search.matchesPipelineSearch({ company: 'Other', title: 'Demo', private_note: 'secret' }, 'secret'), false);

// UI uses the actual history component. No message read until explicitly opened.
const dom = new JSDOM('<div id="root"></div>', { url: 'https://crm.test/crm/new-leads?lead_query=Example&lead_page=3' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const emailProjection = load('lib/recorded-company-emails.ts');
let requests = [], emailFailure = false, delayEmail = false, resolveEmail;
const lead = { id: COMPANY, companyName: 'Example', website: '', ownerName: 'Kamm', assignedTo: 'kam', status: 'contacted', sourceDate: '', stage: 'Prospect', email: 'buyer@example.test', contactName: 'Buyer', holdingPageUrl: 'https://demo.test/a', sourceStatus: 'contacted', activity: {}, campaign: 'C1', emailHistory: 'Sent 20 November' };
const fetch = async (url, init) => {
  assert.ok(!init?.method || init.method === 'GET', 'Navigation/history must not create, draft or send anything'); requests.push(url);
  if (url.includes('/emails')) {
    if (delayEmail) return new Promise(resolve => { resolveEmail = resolve; });
    if (emailFailure) throw new Error('Saved email source unavailable');
    if (url.includes('source=mailbox')) return { messages: [{ ...history.messages[0], id: 'from-mailbox', companyId: COMPANY, subject: 'Own mailbox match', text: 'My current correspondence', source: 'Connected mailbox' }], limited: true, mailbox: 'kam@example.test', matchedEmail: 'buyer@example.test' };
    return server.loadRecordedCompanyEmails([COMPANY], true);
  }
  if (url.endsWith('/access')) return { canReview: false };
  return { leads: [lead], isOwner: false, owners: [], total: 75, allCount: 75, page: 3, pageSize: 25, viewCounts: {} };
};
const Email = load('components/crm/CompanyEmailHistory.tsx', { '@/lib/crm': { crmFetch: fetch }, '@/lib/recorded-company-emails': emailProjection }).default;
const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };
const details = load('components/crm/AssignedLeadDetails.tsx', { 'next/link': link, '@/lib/crm': { crmFetch: fetch, clearCrmCache() {} } });
const UI = load('components/crm/AssignedNewLeads.tsx', {
  'next/link': link, 'next/dynamic': { default: () => () => null }, '@/components/crm/AssignedLeadDetails': details, '@/components/crm/NavMenu': { default: () => null }, '@/components/crm/SalesJourneySwitch': { default: () => null },
  '@/components/crm/CompanyEmailHistory': { default: Email }, '@/lib/lead-list-navigation': navigation,
  '@/lib/crm': { crmFetch: fetch, clearCrmCache() {} }, '@/lib/assigned-new-leads': projection, '@/lib/sales-lead-events': load('lib/sales-lead-events.ts'),
}).default;
let root = createRoot(document.getElementById('root'));
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent === label);
await act(async () => root.render(React.createElement(UI, { onOpenInbound() {} })));
assert.equal(document.querySelector('[aria-label="Search leads"]').value, 'Example');
assert.ok(requests.filter(url => url.includes('/api/crm/new-leads?')).every(url => url.includes('page=3') && url.includes('search=Example')));
assert.ok(!requests.some(url => url.endsWith('/emails')));
assert.match(document.body.textContent, /Sheet · Contacted/); assert.match(document.body.textContent, /No demo or reply event recorded/);
assert.doesNotMatch(document.body.textContent, /Email history recorded|No tracked activity/);
assert.equal(document.querySelector('a[href*="import-leads"]').getAttribute('href'), '/crm/outreach?tab=prospects#import-leads');
assert.equal(document.querySelector('a[href*="import-leads"]').textContent, 'Upload to Outreach', 'Make the existing importer destination explicit');
snapshot('leads');
await act(async () => root.render(React.createElement(Email, { companyId: COMPANY })));
await act(async () => button('Read email history').click());
assert.match(document.body.textContent, /Friday works for us/); assert.match(document.body.textContent, /Other people’s mailboxes/);
assert.equal(document.querySelectorAll('script').length, 0, 'Saved text must not become HTML');
assert.doesNotMatch(document.body.textContent, /No email shown in the recent CRM history/, 'Opening a history updates the preview too');
snapshot('email-history');
await act(async () => button('Close email history').click());
assert.match(document.body.textContent, /Friday works/);
emailFailure = true;
await act(async () => button('Read email history').click()); assert.match(document.querySelector('[role="alert"]').textContent, /unavailable/);
emailFailure = false;
await act(async () => button('Reload email history').click()); assert.match(document.body.textContent, /Here is your proposal/);
assert.ok(!requests.some(url => url.includes('source=mailbox')));
await act(async () => button('Check my connected mailbox').click());
assert.equal(requests.filter(url => url.includes('source=mailbox')).length, 1);
assert.match(document.body.textContent, /My current correspondence/);
await act(async () => button('Show saved CRM emails').click());
await act(async () => root.render(React.createElement(UI, { onOpenInbound() {} })));
await act(async () => { window.history.pushState({}, '', '/crm/new-leads?lead_query=Restored&lead_page=2'); window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
assert.equal(document.querySelector('[aria-label="Search leads"]').value, 'Restored'); assert.match(window.location.search, /lead_page=2/);
await act(async () => root.unmount());
root = createRoot(document.getElementById('root'));
delayEmail = true;
await act(async () => root.render(React.createElement(Email, { companyId: COMPANY })));
await act(async () => button('Read email history').click());
const resolveOld = resolveEmail;
await act(async () => root.render(React.createElement(Email, { companyId: OTHER })));
assert.ok(button('Read email history'), 'Switching company must close the previous history');
await act(async () => button('Read email history').click());
const resolveNew = resolveEmail;
await act(async () => resolveNew({ messages: [], limited: false }));
await act(async () => resolveOld({ messages: [{ id: 'stale', companyId: COMPANY, text: 'Friday works', subject: 'Old company' }], limited: false }));
assert.doesNotMatch(document.body.textContent, /Friday works/);
await act(async () => root.unmount());

// Search changes both pipeline layouts, keeps stage/owner filters, and persists
// when returning from a record. No extra data source is searched.
const pipelineEntry = load('lib/pipeline-entry.ts');
const Pipeline = load('components/crm/PipelineWorkspace.tsx', {
  'next/link': link, '@/lib/crm': { crmFetch: fetch }, '@/lib/opportunity-fields': load('lib/opportunity-fields.ts'),
  '@/lib/opportunity-owner-filter': load('lib/opportunity-owner-filter.ts'), '@/lib/pipeline-search': search,
  '@/lib/pipeline-entry': pipelineEntry, '@/components/crm/MetricDrilldown': load('components/crm/MetricDrilldown.tsx', { 'next/link': link }),
  '@/lib/pipeline-stage-drag': load('lib/pipeline-stage-drag.ts', { '@/lib/pipeline-entry': pipelineEntry }),
}).default;
const row = { id: 'deal-a', company_id: COMPANY, company: 'Example Engineering', title: 'Adam inbound pilot', pipeline_stage: 'discovery', win_outlook: 'possible', created_at: '2026-11-23T10:00:00Z', value: 5000, nextAction: 'Book a demo', next_action: 'Book a demo', assigned_to_user_id: 'kam', owner_id: 'kam', risks: [], outlookQuestions: [], priorityReasons: [], status: 'open' };
const rows = [row, { ...row, id: 'deal-b', company: 'Café Software', title: 'Hiring demo', company_id: OTHER }, { ...row, id: 'private', company: 'HIDDEN PRIVATE DEAL', assigned_to_user_id: 'lee', owner_id: 'lee' }];
const props = { rows, savedRows: rows, stageDefinitions: [{ key: 'discovery', label: 'Discovery' }, { key: 'proposal', label: 'Proposal' }], team: [], currentUser: 'kam', canManageAssignments: false, ownerFilter: 'all', onOwnerFilterChange() {}, busy: '', onChange() {}, onSave() {}, onRemove() {}, onStageMove: async () => { throw new Error('Search must not move deals'); } };
window.history.replaceState({}, '', '/crm/revenue?pipeline_search=Engineering');
root = createRoot(document.getElementById('root'));
await act(async () => root.render(React.createElement(Pipeline, props)));
assert.equal(document.querySelector('[aria-label="Search deals"]').value, 'Engineering');
assert.match(document.body.textContent, /Example Engineering/); assert.doesNotMatch(document.body.textContent, /Café Software|HIDDEN PRIVATE DEAL/);
snapshot('pipeline');
await act(async () => button('kanban').click());
assert.match(document.body.textContent, /Example Engineering/); assert.doesNotMatch(document.body.textContent, /Café Software|HIDDEN PRIVATE DEAL/);
snapshot('pipeline-board');
await act(async () => button('Clear search').click());
assert.match(document.body.textContent, /Café Software/); assert.doesNotMatch(document.body.textContent, /HIDDEN PRIVATE DEAL/);
assert.equal(new URLSearchParams(window.location.search).has('pipeline_search'), false);
await act(async () => { window.history.pushState({}, '', '/crm/revenue?pipeline_search=missing'); window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
assert.ok([...document.querySelectorAll('[role="status"]')].some(element => /No deals match this search/.test(element.textContent)));
await act(async () => root.unmount());
console.log('Sales history/navigation passed. Own-mailbox and workspace scope, active membership, exact company IDs, confirmed sends only, deduplication, bounded reads, private metadata, unavailable vs empty, lazy text, safe rendering, saved filters and upload navigation.');
