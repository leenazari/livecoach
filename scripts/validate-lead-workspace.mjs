import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
function load(file, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name === 'server-only' ? {} : name in deps ? deps[name] : require(name), module, module.exports);
  return module.exports;
}
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', DEAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let scope = { userId: 'kam', workspaceId: 'w', role: 'owner' }, failTable = '', writes = 0, reads = [], companyAccess = true;
const base = { workspace_id: 'w', owner_id: 'kam', company_id: COMPANY };
const db = {
  workspace_members: ['kam', 'sharon', 'lee'].map(user_id => ({ workspace_id: 'w', user_id, role: user_id === 'lee' ? 'owner' : 'sales', status: 'active' })),
  client_context: [
    { ...base, id: 'note-a', kind: 'note', title: 'Phone call', content: 'Interested in the inbound demo.', created_at: '2026-11-24T10:00:00Z', secret: 'HIDDEN_ATTRIBUTE' },
    { ...base, id: 'note-b', owner_id: 'sharon', kind: 'note', title: 'Note', content: 'SHARON_ONLY', created_at: '2026-11-24T11:00:00Z' },
    { ...base, id: 'private', owner_id: 'lee', kind: 'note', title: 'Private', content: 'LEE_PRIVATE', created_at: '2026-11-24T12:00:00Z' },
    { ...base, id: 'other', company_id: OTHER, kind: 'note', content: 'OTHER_COMPANY' },
    { ...base, id: 'foreign', workspace_id: 'foreign', kind: 'note', content: 'FOREIGN_WORKSPACE' },
    { ...base, id: 'mail', kind: 'email_reply', content: 'NOT_A_NOTE' },
  ],
  tasks: [
    { ...base, id: 'task-a', text: 'Confirm demo agenda', due_at: '2026-11-25', status: 'open', done_at: null },
    { ...base, id: 'task-b', owner_id: 'sharon', text: 'SHARON_TASK', status: 'open', done_at: null },
    { ...base, id: 'done', text: 'DONE_TASK', status: 'done', done_at: '2026-11-23' },
    { ...base, id: 'hidden', text: 'DISMISSED_TASK', status: 'dismissed', done_at: null },
    { ...base, id: 'foreign', workspace_id: 'foreign', text: 'FOREIGN_TASK', status: 'open', done_at: null },
  ],
};
class Query {
  constructor(table) { this.table = table; this.filters = []; this.max = Infinity; }
  select(fields) { assert.ok(!fields.includes('*')); this.fields = fields; return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  is(key, value) { return this.eq(key, value); }
  order() { return this; }
  limit(max) { assert.ok(max <= 13); this.max = max; return this; }
  abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; }
  maybeSingle() { this.one = true; return this; }
  single() { return this.maybeSingle(); }
  insert(row) { this.inserted = row; return this; }
  then(resolve, reject) {
    const operation = async () => {
      reads.push({ table: this.table, fields: this.fields, filters: this.filters.length });
      if (failTable === this.table) return { data: null, error: new Error('HIDDEN_DATABASE_ERROR') };
      if (this.inserted) {
        writes++;
        if (db[this.table].some(row => row.id === this.inserted.id)) return { data: null, error: { code: '23505' } };
        const row = { ...this.inserted, created_at: '2026-11-24T15:00:00Z' }; db[this.table].unshift(row);
        return { data: row, error: null };
      }
      const rows = db[this.table].filter(row => this.filters.every(filter => filter(row))).slice(0, this.max);
      return { data: this.one ? rows[0] || null : rows, error: null };
    };
    return operation().then(resolve, reject);
  }
}
const client = { from: table => new Query(table) };
const blocker = { crmBlockerPayload: value => ({ error: value.title, blocker: value }) };
const json = (data, options) => ({ data, status: options?.status || 200, ...options });
const deps = {
  'next/server': { NextResponse: { json } }, '@/lib/supabase': { supabaseAdmin: client, supabaseService: client },
  '@/lib/request-scope': { requireRequestScope: () => scope }, '@/lib/crm-blocker': blocker,
};
deps['@/lib/sales-lead-service'] = load('lib/sales-lead-service.ts', deps);
const lead = { id: COMPANY, companyName: 'Example Engineering', ownerName: 'Kamm', assignedTo: 'kam', stage: 'Prospect', status: 'contacted', sourceDate: '24 November', sourceStatus: 'Contacted', email: 'buyer@example.test', contactName: 'Alex Buyer', contactRole: 'Head of Operations', phone: '+44 121 555 0101', holdingPageUrl: 'https://demo.test/example', campaign: 'Adam inbound', activity: {}, notes: 'Imported source note', opportunityId: DEAL };
class AssignedLeadAccessError extends Error {}
deps['@/lib/assigned-new-leads-server'] = { AssignedLeadAccessError, loadAssignedNewLeads: async id => { assert.equal(id, COMPANY); return { leads: companyAccess ? [lead] : [] }; } };
let deal = { ...base, id: DEAL, title: 'Inbound pilot', pipeline_stage: 'discovery', next_action: 'Show the booking flow', next_action_due_at: '2026-11-26', private_context: 'HIDDEN_DEAL_CONTEXT' };
deps['@/lib/opportunity-access'] = { loadVisibleOpportunityById: async (actor, id, fields) => { assert.equal(actor.role, db.workspace_members.find(row => row.user_id === actor.userId).role, 'Use fresh membership role'); assert.equal(id, DEAL); assert.ok(!fields.includes('*')); return deal; } };
deps['@/lib/assigned-client-access'] = { loadAssignedClientAccess: async (id, actor) => companyAccess && id === COMPANY && actor.workspaceId === 'w' ? { mode: 'shared_sales' } : null };
const route = load('app/api/crm/new-leads/[id]/workspace/route.ts', deps);
const get = (id = COMPANY) => route.GET({}, { params: { id } });
let result = await get();
assert.equal(result.status, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store');
assert.deepEqual(result.data.notes.map(row => row.id), ['note-a']); assert.deepEqual(result.data.tasks.map(row => row.id), ['task-a']);
assert.doesNotMatch(JSON.stringify(result.data), /HIDDEN_|SHARON_|LEE_PRIVATE|OTHER_COMPANY|FOREIGN_|NOT_A_NOTE|DONE_TASK|DISMISSED_TASK|owner_id|workspace_id/);
assert.equal(writes, 0, 'Opening a workspace is read-only');
scope.userId = 'sharon'; result = await get(); assert.deepEqual(result.data.notes.map(row => row.id), ['note-b']); assert.deepEqual(result.data.tasks.map(row => row.id), ['task-b']);
scope.userId = 'lee'; result = await get(); assert.deepEqual(result.data.notes.map(row => row.id), ['private']); assert.equal(result.data.tasks.length, 0, 'Owner sees own tasks, not every rep task');
scope.userId = 'kam'; companyAccess = false; reads = []; assert.equal((await get()).status, 403); assert.ok(reads.every(row => row.table === 'workspace_members'));
companyAccess = true;
for (const status of ['removed', 'suspended', 'onboarding']) { db.workspace_members[0].status = status; reads = []; assert.equal((await get()).status, 403); assert.ok(reads.every(row => row.table === 'workspace_members')); }
db.workspace_members[0].status = 'active'; db.workspace_members[0].role = 'unknown'; assert.equal((await get()).status, 403); db.workspace_members[0].role = 'sales';
scope.workspaceId = 'foreign'; assert.equal((await get()).status, 403); scope.workspaceId = 'w';
assert.equal((await get('bad')).status, 400);
for (const table of ['tasks', 'client_context']) { failTable = table; result = await get(); assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result), /HIDDEN_DATABASE_ERROR/); assert.equal(result.data.notes, undefined); }
failTable = ''; deal.company_id = OTHER; assert.equal((await get()).data.opportunity, null); deal.company_id = COMPANY;
const oldNotes = db.client_context, oldTasks = db.tasks;
db.client_context = Array.from({ length: 30 }, (_, i) => ({ ...oldNotes[0], id: `note${i}` }));
db.tasks = Array.from({ length: 30 }, (_, i) => ({ ...oldTasks[0], id: `task${i}` }));
result = await get(); assert.equal(result.data.notes.length, 12); assert.equal(result.data.tasks.length, 8); assert.deepEqual(result.data.limited, { notes: true, tasks: true });
db.client_context = oldNotes; db.tasks = oldTasks;

const notes = load('lib/manual-client-note.ts', deps);
const noteBody = { requestId: NOTE, channel: 'phone', content: 'A demo next week would help.', analyse: false };
result = await notes.saveManualClientNote(COMPANY, noteBody);
assert.equal(result.status, 200); assert.equal(writes, 1); assert.equal(result.data.intelligence, null); assert.doesNotMatch(JSON.stringify(result.data), /owner_id|workspace_id/);
await notes.saveManualClientNote(COMPANY, noteBody); assert.equal(writes, 1, 'Exact retry returns the canonical note without inserting again');
assert.equal((await notes.saveManualClientNote(COMPANY, { ...noteBody, content: 'Different text' })).status, 409);
assert.equal(db.client_context.find(row => row.id === NOTE).content, noteBody.content);
scope.userId = 'sharon'; result = await notes.saveManualClientNote(COMPANY, noteBody); assert.equal(result.status, 409); assert.doesNotMatch(JSON.stringify(result), /A demo next week/); scope.userId = 'kam';
for (const patch of [{ channel: 'email' }, { content: 'x'.repeat(4001) }, { content: '' }, { autoApply: true }, { completeTaskId: NOTE }, { requestId: 'bad' }]) assert.equal((await notes.saveManualClientNote(COMPANY, { ...noteBody, ...patch })).status, 400);
companyAccess = false; assert.equal((await notes.saveManualClientNote(COMPANY, noteBody)).status, 403); companyAccess = true;
db.workspace_members[0].status = 'removed'; assert.equal((await notes.saveManualClientNote(COMPANY, noteBody)).status, 403); db.workspace_members[0].status = 'active';
failTable = 'client_context'; result = await notes.saveManualClientNote(COMPANY, noteBody); assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result), /HIDDEN_DATABASE_ERROR/); failTable = '';
const racingId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const racing = await Promise.all([1, 2].map(() => notes.saveManualClientNote(COMPANY, { ...noteBody, requestId: racingId })));
assert.ok(racing.every(response => response.status === 200));
assert.equal(db.client_context.filter(row => row.id === racingId).length, 1, 'Concurrent retries still store only one source note');
assert.doesNotMatch(readFileSync('lib/manual-client-note.ts', 'utf8'), /openai|enqueueOpportunitySignal|approveActivity|getCommercialMemory/);
assert.match(readFileSync('app/api/crm/companies/[id]/activity/route.ts', 'utf8'), /body\.analyse === false\) return saveManualClientNote/);
assert.match(readFileSync('components/crm/LeadWorkspace.tsx', 'utf8'), /guard\.current\.form = state; setForm\(state\)/, 'Native Escape sees completed form state before the parent render commits');

// The real workspace and forms, with transport-only stubs. No private history
// or expensive control is loaded before the user opens a row.
const dom = new JSDOM('<div id="root"></div>', { url: 'https://crm.test/crm/new-leads?lead_page=2&lead_query=Example' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector('[autofocus],button')?.focus(); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
dom.window.HTMLElement.prototype.scrollTo = function () {};
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
let requests = [], uiWrites = [], delayed = false, pending = [], noteFailure = false, wrongReceipt = false, workspaceFailure = false, confirmations = 0, allowDiscard = false;
window.confirm = () => { confirmations++; return allowDiscard; };
const another = { ...lead, id: OTHER, companyName: 'Example Software', contactName: 'Jordan Buyer', opportunityId: null };
const workspaceFor = id => ({ lead: id === COMPANY ? lead : another, notes: [{ id: 'recent', title: 'Phone call', content: id === COMPANY ? 'FIRST COMPANY NOTE' : 'SECOND COMPANY NOTE', createdAt: '2026-11-24T11:20:00Z' }], tasks: [{ id: 'task', text: 'Confirm the demo agenda', dueAt: '2026-11-25' }], opportunity: { id: DEAL, title: 'Pilot', stage: 'discovery', nextAction: 'Show the booking flow', dueAt: '2026-11-26' }, limited: { notes: false, tasks: false } });
const uiFetch = async (url, init) => {
  requests.push(url);
  if (init?.method === 'POST') {
    const body = JSON.parse(init.body); uiWrites.push({ url, body });
    if (url === '/api/crm/tasks') return { ok: true, created: true, task: { id: 'created-task', company_id: body.companyId } };
    if (noteFailure) throw new Error('Save status unknown. Check recent notes first.');
    return { item: { id: wrongReceipt ? 'wrong-id' : body.requestId, company_id: url.includes(COMPANY) ? COMPANY : OTHER, content: body.content } };
  }
  if (url.endsWith('/workspace')) {
    if (workspaceFailure) throw new Error('Activity could not be loaded');
    if (delayed) return new Promise(resolve => pending.push({ url, resolve }));
    return workspaceFor(url.includes(COMPANY) ? COMPANY : OTHER);
  }
  if (url.includes('/emails')) return { messages: [], limited: false };
  if (url.endsWith('/access')) return { canReview: false };
  return { leads: [lead, another], isOwner: false, owners: [], total: 30, allCount: 30, page: 2, pageSize: 25, viewCounts: {} };
};
const uiDeps = {
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  '@/components/crm/NavMenu': { default: () => null }, '@/components/crm/CompanyLinkPicker': { default: () => null },
  '@/lib/crm': { crmFetch: uiFetch, clearCrmCache() {}, crmConfirmationError: ({ reason }) => new Error(reason) },
};
const cache = new Map();
function uiLoad(name) {
  if (name in uiDeps) return uiDeps[name];
  if (!name.startsWith('@/')) return require(name);
  if (cache.has(name)) return cache.get(name);
  const file = path.join(process.cwd(), name.slice(2) + (name.startsWith('@/components') ? '.tsx' : '.ts'));
  const module = { exports: {} }; cache.set(name, module.exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(uiLoad, module, module.exports); cache.set(name, module.exports); return module.exports;
}
uiDeps['next/dynamic'] = { default: () => uiLoad('@/components/crm/LeadWorkspace').default };
const UI = uiLoad('@/components/crm/AssignedNewLeads').default;
const Workspace = uiLoad('@/components/crm/LeadWorkspace').default;
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
const click = async node => { assert.ok(node, 'Expected button'); await act(async () => node.click()); };
const change = async (node, value) => { await act(async () => { const proto = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
let root = createRoot(document.getElementById('root'));
await act(async () => root.render(React.createElement(UI, { onOpenInbound() {} })));
assert.equal(requests.filter(url => /workspace|emails/.test(url)).length, 0);
assert.equal(document.querySelectorAll('article').length, 2);
assert.equal(document.querySelector('[aria-label="Search leads"]').value, 'Example');
await click(document.querySelector('[aria-label="Work on Example Engineering"]'));
assert.equal(document.querySelector('dialog').open, true); assert.equal(document.body.style.overflow, 'hidden');
assert.match(document.body.textContent, /FIRST COMPANY NOTE/); assert.doesNotMatch(document.body.textContent, /SECOND COMPANY NOTE/); assert.equal(uiWrites.length, 0);
await click(button('Read email history')); assert.equal(requests.filter(url => url.endsWith('/emails')).length, 1);
await click(button('Add note'));
await change(document.querySelector('form[aria-label="Add a note"] textarea'), 'Spoke with Alex about the demo.');
await click(button('Next lead →')); assert.equal(confirmations, 1); assert.equal(document.querySelector('#lead-workspace-title').textContent, lead.companyName);
const cancel = new dom.window.Event('cancel', { cancelable: true }); await act(async () => document.querySelector('dialog').dispatchEvent(cancel)); assert.equal(cancel.defaultPrevented, true); assert.ok(document.querySelector('dialog'));
noteFailure = true; await click(button('Save note')); assert.equal(uiWrites.length, 1); assert.equal(uiWrites[0].body.analyse, false); assert.equal(uiWrites[0].body.autoApply, undefined);
assert.equal(document.querySelector('form[aria-label="Add a note"] textarea').value, 'Spoke with Alex about the demo.');
await click(button('Check recent notes')); assert.equal(document.querySelector('form[aria-label="Add a note"] textarea').value, 'Spoke with Alex about the demo.', 'Reloading history preserves unsaved note');
noteFailure = false; await click(button('Retry unchanged note')); assert.equal(uiWrites[1].body.requestId, uiWrites[0].body.requestId); assert.match(document.body.textContent, /Note saved/);
assert.equal(document.querySelector('form[aria-label="Add a note"] textarea').value, '');
await click(button('Next lead →')); assert.equal(document.querySelector('#lead-workspace-title').textContent, another.companyName); assert.doesNotMatch(document.querySelector('dialog').textContent, /FIRST COMPANY NOTE/);
await click(button('Add task')); const taskText = document.querySelector('textarea'); await change(taskText, 'Review Jordan demo plan');
await click(button('Save task')); const taskWrite = uiWrites.at(-1); assert.equal(taskWrite.url, '/api/crm/tasks'); assert.equal(taskWrite.body.companyId, OTHER); assert.ok(taskWrite.body.requestId);
await click(document.querySelector('[aria-label="Close lead workspace"]')); assert.equal(document.querySelector('dialog'), null); assert.equal(document.body.style.overflow, ''); assert.match(window.location.search, /lead_page=2/); assert.equal(document.querySelector('[aria-label="Search leads"]').value, 'Example');
await act(async () => root.unmount());

// Old reads cannot populate a new company after a rapid next/previous action.
delayed = true; pending = []; root = createRoot(document.getElementById('root'));
await act(async () => root.render(React.createElement(Workspace, { leads: [lead, another], initialIndex: 0, emailHistoryAvailable: true, onClose() {} })));
await click(button('Next lead →')); assert.equal(pending.length, 2);
await act(async () => pending[1].resolve(workspaceFor(OTHER))); await act(async () => pending[0].resolve(workspaceFor(COMPANY)));
assert.doesNotMatch(document.querySelector('dialog').textContent, /FIRST COMPANY NOTE/); assert.match(document.querySelector('dialog').textContent, /SECOND COMPANY NOTE/);
await act(async () => root.unmount()); delayed = false;

// Read failure is not presented as an empty history, and does not enable forms.
workspaceFailure = true; root = createRoot(document.getElementById('root'));
await act(async () => root.render(React.createElement(Workspace, { leads: [lead], initialIndex: 0, emailHistoryAvailable: true, onClose() {} })));
assert.match(document.querySelector('[role="alert"]').textContent, /could not be loaded/); assert.equal(button('Add note'), undefined); assert.doesNotMatch(document.body.textContent, /No notes logged/);
workspaceFailure = false; await click(button('Reload workspace')); await click(button('Log call'));
window.SpeechRecognition = class { start() { throw new Error('Mic unavailable'); } stop() { throw new Error('Already stopped'); } abort() {} };
await click(button('Speak note')); assert.match(document.querySelector('[role="alert"]').textContent, /microphone could not start/);
delete window.SpeechRecognition;
await change(document.querySelector('textarea'), 'Buyer wants a pilot.'); wrongReceipt = true; await click(button('Save call log')); assert.equal(document.querySelector('textarea').value, 'Buyer wants a pilot.'); assert.doesNotMatch(document.body.textContent, /Call logged/);
wrongReceipt = false; await click(button('Retry unchanged note')); assert.match(document.body.textContent, /Call logged/);
await act(async () => root.unmount());
console.log('Lead workspace passed. Lazy read-only opening, exact company and account scope, active membership, bounded history, safe note retry, no AI/drafts/stage changes, notes/tasks saved to the correct company, dirty guards, stale-read isolation and honest errors.');
