import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function compile(path, replacements = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const code = vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: path });
  code(name => name === 'server-only' ? {} : replacements[name] || require(name), module, module.exports);
  return module.exports;
}
const alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222';
const workspace = '33333333-3333-4333-8333-333333333333', outside = '44444444-4444-4444-8444-444444444444';
const aid = '55555555-5555-4555-8555-555555555555', bid = '66666666-6666-4666-8666-666666666666', oid = '77777777-7777-4777-8777-777777777777';
const stamp = '2026-10-04T17:00:00.000Z';
const fixtures = () => [
  { id: aid, owner_id: alice, workspace_id: workspace, assigned_to_user_id: alice, text: 'Alice task', name: 'Alice campaign', title: 'Alice work', company_name: 'Alice company', status: 'open', notes: 'Existing context', due_at: null, payload: { pinned: true, preserved: 'yes' }, created_at: stamp, updated_at: stamp },
  { id: bid, owner_id: bob, workspace_id: workspace, assigned_to_user_id: bob, text: 'Bob private task', name: 'Bob private campaign', title: 'Bob private work', company_name: 'Bob private company', status: 'open', notes: 'Bob private notes', due_at: null, payload: {}, created_at: stamp, updated_at: stamp },
  { id: oid, owner_id: alice, workspace_id: outside, assigned_to_user_id: alice, text: 'Other workspace', name: 'Other workspace', title: 'Other workspace', company_name: 'Other workspace', status: 'open', notes: '', due_at: null, payload: {}, created_at: stamp, updated_at: stamp },
];
const tables = ['tasks', 'marketing_campaigns', 'marketing_leads', 'outreach_prospects', 'companies', 'contacts', 'opportunities', 'interview_summaries', 'upcoming_calls', 'knowledge_docs', 'assistant_messages', 'brain_learnings', 'workspace_profile', 'email_assistant_drafts', 'marketing_connections'];
const db = Object.fromEntries(tables.map(table => [table, fixtures()]));
db.workspace_members = [{ user_id: alice, workspace_id: workspace, role: 'owner', status: 'active', department: 'marketing' }, { user_id: bob, workspace_id: workspace, role: 'sales', status: 'active', department: 'sales' }];
db.marketing_lead_feedback = [];
const logs = [], mailboxOwners = [];
let sequence = 10;
const clone = row => structuredClone(row);
// This deliberately broad client has no RLS: application filters must prove isolation.
const client = { from(table) {
  let predicates = [], action = null, values = null, fields = '*', start = 0, end = Infinity, one = false, dedupe = null;
  const log = { table, filters: [], action: 'read' }; logs.push(log);
  const builder = {
    select(selection) { fields = selection; return this; },
    eq(key, value) { log.filters.push([key, value]); predicates.push(row => key === 'payload' ? JSON.stringify(row[key]) === value : row[key] === value); return this; },
    is(key, value) { log.filters.push([key, value]); predicates.push(row => (row[key] ?? null) === value); return this; },
    or(filter) { const user = filter.match(/[a-f0-9-]{36}/)?.[0]; assert.ok(user); predicates.push(row => filter.includes('assigned_to_user_id.is.null') ? row.assigned_to_user_id === user || (row.owner_id === user && !row.assigned_to_user_id) : row.owner_id === user || row.assigned_to_user_id === user); return this; },
    ilike(key, pattern) { const term = pattern.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase(); predicates.push(row => String(row[key] || '').toLowerCase().includes(term)); return this; },
    order() { return this; }, range(a,b) { start = a; end = b + 1; return this; }, limit(n) { end = n; return this; },
    maybeSingle() { one = true; return this; }, single() { one = true; return this; },
    insert(input) { action = 'insert'; values = input; log.action = action; return this; },
    upsert(input, options) { action = 'upsert'; values = input; dedupe = options.onConflict.split(','); log.action = action; return this; },
    update(input) { action = 'update'; values = input; log.action = action; return this; },
    then(resolve,reject) {
      try {
        let rows = db[table].filter(row => predicates.every(test => test(row)));
        if (action === 'update') rows.forEach(row => Object.assign(row, clone(values)));
        if (action === 'insert' || action === 'upsert') {
          const existing = action === 'upsert' && db[table].find(row => dedupe.every(key => row[key] === values[key]));
          if (existing) rows = []; else { const record = { id: `${String(sequence++).padStart(8, '0')}-1111-4111-8111-111111111111`, created_at: stamp, ...clone(values) }; db[table].push(record); rows = [record]; }
        }
        const count = rows.length;
        rows = rows.slice(start,end).map(row => fields === '*' ? clone(row) : Object.fromEntries(fields.split(',').map(key => [key, clone(row[key] ?? null)])));
        return Promise.resolve({ data: one ? rows[0] || null : rows, count, error: null }).then(resolve,reject);
      } catch(error) { return Promise.reject(error).then(resolve,reject); }
    }
  }; return builder;
}};
const mail = {
  connectedMailProvider: async owner => { mailboxOwners.push(owner); return { provider: 'google', email: `${owner}@test.invalid` }; },
  recentMessages: async (_query,_limit,owner) => { mailboxOwners.push(owner); return [{ id: `${owner}-mail`, subject: 'My email' }]; },
  freshMessageText: async (id,_max,owner) => { mailboxOwners.push(owner); return id === `${owner}-mail` ? 'Personal message text' : ''; },
};
const marketing = compile('lib/marketing.ts');
const { registerPersonalMcpTools, PERSONAL_MCP_TOOLS } = compile('lib/staff-mcp-personal.ts', { '@/lib/marketing': marketing, '@/lib/mail': mail });
function session(userId = alice, workspaceId = workspace, role = 'owner') {
  const tools = new Map(); const principal = { userId, workspaceId, role, clientId: aid, accessToken: 'verified-user-token' };
  registerPersonalMcpTools({ registerTool(name, config, fn) { tools.set(name, { config, fn }); } }, principal, async (_name,_args,_ctx,run) => run({ client, receipt: { id: aid } }));
  return { tools, call: async (name,input) => { const tool = tools.get(name); return tool.fn(tool.config.inputSchema.parse(input), { mcpReq: { id: sequence++ } }); } };
}
const a = session();
assert.deepEqual([...a.tools.keys()], [...PERSONAL_MCP_TOOLS]);
for (const tool of a.tools.values()) assert.equal(tool.config.annotations.openWorldHint, false);
for (const resource of ['tasks','campaigns','marketing_leads','sales_leads','companies','contacts','opportunities','calls','calendar','documents','brain_history','brain_learnings','profile','email_drafts','analytics']) {
  const r = await a.call('list_my_work', { resource });
  assert.equal(r.data.records.length, 1, resource); assert.doesNotMatch(JSON.stringify(r.data), /Bob private|Other workspace/);
  await assert.rejects(() => a.call('get_my_work_record', { resource, id: bid }), /not in your personal|without a record ID/);
}
assert.throws(() => a.tools.get('list_my_work').config.inputSchema.parse({ resource: 'tasks', ownerId: bob }));
assert.throws(() => a.tools.get('list_my_work').config.inputSchema.parse({ resource: 'google_oauth' }));
const b = session(bob, workspace, 'sales');
const bTasks = await b.call('list_my_work', { resource: 'tasks' }); assert.equal(bTasks.data.records[0].id, bid);
const cross = session(alice, outside); const crossTasks = await cross.call('list_my_work', { resource: 'tasks' }); assert.equal(crossTasks.data.records[0].id, oid);
const task = await a.call('get_my_work_record', { resource: 'tasks', id: aid });
await assert.rejects(() => a.call('update_my_task', { id: bid, version: task.data.version, status: 'done' }), /not in your personal/);
const updated = await a.call('update_my_task', { id: aid, version: task.data.version, status: 'done', note: 'Completed the review' });
assert.equal(updated.data.task.status, 'done'); assert.equal(updated.data.task.payload.preserved, 'yes'); assert.equal(updated.data.task.payload.chatgptNotes[0].text, 'Completed the review');
await assert.rejects(() => a.call('update_my_task', { id: aid, version: task.data.version, text: 'Stale edit' }), /has changed/);
assert.equal(db.tasks.find(r => r.id === bid).status, 'open');
const request = { requestId: '88888888-8888-4888-8888-888888888888', text: 'Check campaign quality', dueAt: '2026-10-15', successMeasure: '5 accepted leads', section: 'today', approach: 'sales-feedback' };
const created = await a.call('create_my_task', request); const replay = await a.call('create_my_task', request);
assert.equal(created.outcome, 'created'); assert.equal(replay.outcome, 'existing'); assert.equal(created.data.task.id, replay.data.task.id); assert.equal(db.tasks.filter(r => r.source === 'marketing').length, 1);
assert.equal(created.data.task.payload.dueOn, '2026-10-15');
const lateReview = await a.call('update_my_task', { id: created.data.task.id, version: created.data.version, dueAt: '2026-10-15T23:30:00Z' });
assert.equal(lateReview.data.task.payload.dueOn, '2026-10-16');
assert.equal(created.data.task.payload.approach, 'sales-feedback'); assert.equal(created.data.task.payload.steps.length, 3);
await assert.rejects(() => a.call('create_my_task', { ...request, requestId: oid, dueAt: '2026-02-30' }), /valid review date/);
const campaign = { action: 'update', id: bid, updatedAt: stamp, name: 'My campaign', audience: 'UK recruiters', offer: 'Try screening', channel: 'linkedin', spendGbp: 10, successMeasure: '5 accepted leads', reviewOn: '2026-10-15' };
await assert.rejects(() => a.call('save_my_campaign', campaign), /not in your personal/);
await assert.rejects(() => a.call('save_my_campaign', { ...campaign, id: aid, updatedAt: 'stale' }), /Read the current campaign/);
const savedCampaign = await a.call('save_my_campaign', { ...campaign, id: aid }); assert.equal(savedCampaign.outcome, 'updated'); assert.equal(db.marketing_campaigns.find(r => r.id === bid).name, 'Bob private campaign');
await assert.rejects(() => b.call('save_my_campaign', { ...campaign, action: 'create', id: oid }), /marketing access/);
await assert.rejects(() => a.call('save_my_marketing_lead', { action: 'create', id: oid, campaignId: bid, companyName: 'Test', notes: 'Qualified' }), /not in your personal/);
await assert.rejects(() => a.call('append_my_note', { resource: 'companies', id: bid, note: 'Foreign edit' }), /not in your personal/);
await a.call('append_my_note', { resource: 'companies', id: aid, note: 'Verified buyer need' }); const repeated = await a.call('append_my_note', { resource: 'companies', id: aid, note: 'Verified buyer need' });
assert.equal(repeated.outcome, 'existing'); assert.equal(db.companies.find(r => r.id === aid).notes, 'Existing context\n\nChatGPT context: Verified buyer need');
const leadRow = db.marketing_leads.find(r => r.id === aid); Object.assign(leadRow, { campaign_id: aid, contact_name: 'Original contact', contact_email: 'original@test.invalid', company_size: '30' });
const readLead = await a.call('get_my_work_record', { resource: 'marketing_leads', id: aid });
await a.call('save_my_marketing_lead', { action: 'update', id: aid, version: readLead.data.version, campaignId: aid, companyName: 'Updated own company', notes: 'More qualification' });
assert.equal(leadRow.contact_name, 'Original contact'); assert.equal(leadRow.contact_email, 'original@test.invalid'); assert.equal(leadRow.company_size, '30'); assert.equal(leadRow.assigned_to_user_id, alice);
await a.call('search_my_email', { query: 'in:inbox' }); await a.call('read_my_email', { messageId: `${alice}-mail` }); await assert.rejects(() => a.call('read_my_email', { messageId: `${bob}-mail` }), /not found in your mailbox/);
assert.ok(mailboxOwners.every(owner => owner === alice));
assert.ok(logs.filter(q => q.action === 'update').every(q => q.filters.some(([key,value]) => key === 'workspace_id' && value === workspace) && q.filters.some(([key,value]) => key === 'owner_id' && value === alice)));
console.log('Personal MCP: two users/workspaces, blocked foreign writes, task replay, stale updates, preserved fields and mailbox ownership passed.');
