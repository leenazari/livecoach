import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const next = require('next/server');
const alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222';
const workspace = '33333333-3333-4333-8333-333333333333', outside = '44444444-4444-4444-8444-444444444444';
const aid = '55555555-5555-4555-8555-555555555555', bid = '66666666-6666-4666-8666-666666666666';
process.env.BRAIN_ACTION_SIGNING_SECRET = 'test-only-brain-signing-secret-do-not-use-in-production';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
const stamp = new Date().toISOString();
const db = {
  tasks: [
    { id: aid, owner_id: alice, workspace_id: workspace, text: 'My follow-up', status: 'open', due_at: null, company_id: null, payload: { preserved: true }, created_at: stamp },
    { id: bid, owner_id: bob, workspace_id: workspace, text: 'Bob private task', status: 'open', due_at: null, company_id: null, payload: {}, created_at: stamp },
  ],
  workspace_members: [{ user_id: alice, workspace_id: workspace, status: 'active', role: 'sales' }, { user_id: bob, workspace_id: workspace, status: 'active', role: 'sales' }],
  brain_action_executions: [], mcp_action_receipts: [], assistant_messages: [],
};
const calls = [], credentials = [], moduleLoads = [], externalSends = [], rpcCalls = [];
let trustBlocked = false, brainCalls = 0;
let checkingRoutes = true;
// No database RLS in this mock. The original handlers must still enforce their
// explicit account/assignment filters. Real RLS remains an additional layer.
function from(table) {
  let fields = '*', predicates = [], mode = 'read', input, one = false, limit = Infinity, conflict;
  const log = { table, mode, filters: [] }; calls.push(log);
  const q = {
    select(value) { fields = value; return this; },
    eq(key, value) { log.filters.push([key, value]); predicates.push(row => row[key] === value); return this; },
    is(key, value) { predicates.push(row => (row[key] ?? null) === value); return this; },
    gt(key, value) { predicates.push(row => row[key] > value); return this; },
    in(key, values) { predicates.push(row => values.includes(row[key])); return this; },
    delete() { mode = 'delete'; return this; },
    gte(key, value) { predicates.push(row => row[key] >= value); return this; },
    lt(key, value) { predicates.push(row => row[key] < value); return this; },
    order() { return this; }, limit(n) { limit = n; return this; },
    or() { return this; }, maybeSingle() { one = true; return this; }, single() { one = true; return this; },
    insert(value) { mode = 'insert'; input = value; log.mode = mode; return this; },
    upsert(value, options) { mode = 'upsert'; input = value; conflict = options.onConflict.split(','); log.mode = mode; return this; },
    update(value) { mode = 'update'; input = value; log.mode = mode; return this; },
    then(resolve, reject) {
      try {
        const tableRows = db[table] ||= [];
        let rows = tableRows.filter(row => predicates.every(test => test(row)));
        if (mode === 'insert' || mode === 'upsert') {
          const duplicate = table === 'mcp_action_receipts' && tableRows.find(row => ['workspace_id','actor_user_id','oauth_client_id','request_fingerprint'].every(key => row[key] === input[key]));
          if (duplicate) return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve, reject);
          const prior = conflict && tableRows.find(row => conflict.every(key => row[key] === input[key]));
          const row = prior || { id: randomUUID(), outcome: 'started', created_at: stamp, updated_at: stamp, undone_at: null };
          Object.assign(row, structuredClone(input)); if (!prior) tableRows.push(row); rows = [row];
        }
        if (mode === 'delete') db[table] = tableRows.filter(row => !rows.includes(row));
        if (mode === 'update') rows.forEach(row => Object.assign(row, structuredClone(input), { updated_at: stamp }));
        const count = rows.length;
        const selection = fields.split(',').map(key => key.trim());
        rows = rows.slice(0, limit).map(row => fields === '*' ? structuredClone(row) : Object.fromEntries(selection.map(key => [key, structuredClone(row[key] ?? null)])));
        return Promise.resolve({ data: one ? rows[0] || null : rows, count, error: null }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    },
  }; return q;
}
const client = { from, rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: { targetId: aid }, error: null }; } };
const cache = new Map();
const realRoutes = new Set([
  'app/api/crm/assistant/execute/route.ts', 'app/api/crm/assistant/receipts/route.ts',
  'app/api/crm/assistant/executions/[id]/undo/route.ts', 'app/api/crm/tasks/[id]/route.ts',
  'app/api/crm/brain/assign-work/route.ts',
]);
function compile(file, suffix = '') {
  if (!suffix && cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; if (!suffix) cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, 'utf8') + suffix, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(dependency, module, module.exports);
  return module.exports;
}
function dependency(name) {
  if (checkingRoutes && name.startsWith('@/app/')) {
    const file = name.slice(2) + '.ts';
    readFileSync(file, 'utf8');
    const handler = async (_request, context) => next.NextResponse.json({ ok: true, route: file, params: context.params });
    return { POST: handler, PATCH: handler, DELETE: handler };
  }
  if (name === 'server-only') return {};
  if (name === 'next/headers') return { headers: () => { throw new Error('No ambient browser session'); } };
  if (name === 'next/server') return next;
  if (name === '@supabase/supabase-js') return { createClient: (_url, key, options) => { credentials.push({ key, token: options.global?.headers?.Authorization }); return client; } };
  if (name === '@/lib/brain-control') return { brainTrustDecision: async () => ({ mode: trustBlocked ? 'blocked' : 'approval_required', reason: 'Existing team policy' }) };
  if (name === '@/lib/tasks') return { actionToLinkKind: action => action, fingerprintTask: (_id, value) => value };
  if (name === '@/lib/text') return { capitaliseSentenceStarts: value => value };
  if (name === '@/lib/follow-up-scheduling') return { followUpAtIsPast: () => false, normaliseFollowUpAt: value => value };
  if (name === '@/lib/crm-blocker') return { crmBlockerPayload: value => value };
  if (name === '@/lib/staff-mcp-auth') return { createStaffMcpClient: accessToken => { credentials.push({ key: 'mcp-user', token: `Bearer ${accessToken}` }); return client; } };
  if (name === '@modelcontextprotocol/server') return { McpServer: class { tools = new Map(); registerTool(name, config, fn) { this.tools.set(name, { config, fn }); } } };
  if (name === '@/app/api/crm/assistant/route') return { POST: async request => {
    brainCalls++;
    const scope = compile('lib/request-scope.ts').requireRequestScope();
    const { message } = await request.json();
    assert.equal(compile('lib/request-scope.ts').isVerifiedServiceRequest(), false);
    const action = message.includes('assign')
      ? { type: 'assign_work', label: 'Assign my task', endpoint: '/api/crm/brain/assign-work', method: 'POST', body: { kind: 'task', recordId: aid, assignedToUserId: bob } }
      : message.includes('email')
        ? { type: 'send_email', label: 'Send exact reviewed email', endpoint: '/api/crm/assistant/email', method: 'POST', body: { recipientName: 'Buyer', email: 'buyer@test.invalid', subject: 'Approved subject', body: 'Exact reviewed body' } }
        : { type: 'update_task', label: 'Complete my task', endpoint: `/api/crm/tasks/${scope.userId === alice ? aid : bid}`, method: 'PATCH', body: { status: 'done' } };
    const token = compile('lib/brain-authority.ts').signBrainAction({ scope, action });
    const frame = message === 'stream-error' ? { type: 'error', error: 'Interrupted' } : { type: 'done', reply: `Brain advice for ${scope.userId}`, spoken: '', proposedActions: [{ ...action, executionToken: token }] };
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'delta', text: 'advice £' }) + '\n' + JSON.stringify(frame) + '\n');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 23)); controller.enqueue(bytes.slice(23, 50)); controller.enqueue(bytes.slice(50)); controller.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } });
  } };
  if (name === '@/app/api/crm/assistant/email/route') return { POST: async request => {
    const scope = compile('lib/request-scope.ts').requireRequestScope();
    externalSends.push({ userId: scope.userId, body: await request.json() });
    return next.NextResponse.json({ ok: true, queued: true, senderUserId: scope.userId });
  } };
  if (name.startsWith('@/app/')) {
    const file = name.slice(2) + '.ts'; moduleLoads.push(file);
    if (realRoutes.has(file)) return compile(file);
    const handler = async (_request, context) => next.NextResponse.json({ ok: true, route: file, params: context.params });
    return { POST: handler, PATCH: handler, DELETE: handler };
  }
  if (name.startsWith('@/lib/')) return compile(name.slice(2) + '.ts');
  return require(name);
}
const { runWithDelegatedRequestScope, delegatedRequestScope } = compile('lib/delegated-request-scope.ts');
const requestScope = compile('lib/request-scope.ts');
const { dispatchDelegatedBrainRoute } = compile('lib/brain-route-dispatch.ts');
const authority = compile('lib/brain-authority.ts');
const scope = (userId = alice, role = 'sales', workspaceId = workspace) => ({ userId, role, workspaceId, status: 'active', accessToken: `${userId}-oauth-token` });
assert.equal(requestScope.getRequestScope(), null);
await assert.rejects(() => dispatchDelegatedBrainRoute('/api/crm/tasks', 'POST', {}), /delegation is required/);
await Promise.all([alice, bob].map(userId => runWithDelegatedRequestScope(scope(userId), async () => {
  await new Promise(resolve => setTimeout(resolve, userId === alice ? 3 : 1));
  assert.equal(requestScope.requireRequestScope().userId, userId);
  assert.equal(requestScope.getVerifiedUser().accessToken, `${userId}-oauth-token`);
  assert.equal(requestScope.isVerifiedServiceRequest(), false);
  compile('lib/supabase.ts').supabaseAdmin.from('tasks');
})));
assert.equal(delegatedRequestScope(), null);
assert.ok(credentials.some(c => c.token === `Bearer ${alice}-oauth-token`));
assert.ok(credentials.some(c => c.token === `Bearer ${bob}-oauth-token`));
for (const endpoint of ['/api/crm/brain-control', '/api/crm/team/members', '/api/crm/tasks?ownerId=bob', 'https://evil.invalid/api/crm/tasks']) {
  await runWithDelegatedRequestScope(scope(), () => assert.rejects(() => dispatchDelegatedBrainRoute(endpoint, 'POST', {}), /not permitted/));
}
// Every allowlisted Brain action must reach its original route module; no
// second implementation of its permissions or business action is used.
const authoritySource = readFileSync('lib/brain-authority.ts', 'utf8');
const paths = authoritySource.slice(authoritySource.indexOf('const ACTION_ENDPOINTS:'), authoritySource.indexOf('\nexport function brainAuthorityProfile'));
const pathModule = { exports: {} };
vm.runInThisContext(`(function(exports){${ts.transpileModule(paths.replace('const ACTION_ENDPOINTS:', 'export const ACTION_ENDPOINTS:'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText}})`)(pathModule.exports);
for (const patterns of Object.values(pathModule.exports.ACTION_ENDPOINTS)) for (const pattern of patterns) {
  const endpoint = pattern.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/').replace('[0-9a-f-]+', aid).replace('(?:voice|voice-script)', 'voice');
  assert.ok(pattern.test(endpoint), endpoint);
  await runWithDelegatedRequestScope(scope(), () => dispatchDelegatedBrainRoute(endpoint, 'POST', {}).catch(error => {
    assert.match(error.message, /method is not supported/);
  }));
}
checkingRoutes = false;
const { buildStaffMcpServer } = compile('lib/staff-mcp-tools.ts');
let id = 0;
function session(userId = alice, role = 'sales', workspaceId = workspace) {
  const principal = { ...scope(userId, role, workspaceId), clientId: aid };
  const server = buildStaffMcpServer(principal);
  return { call: async (name, input) => { const tool = server.tools.get(name); return tool.fn(tool.config.inputSchema.parse(input), { mcpReq: { id: ++id } }); }, server };
}
const a = session(), b = session(bob), owner = session(alice, 'owner');
assert.equal(a.server.tools.size, 19);
assert.throws(() => a.server.tools.get('ask_my_brain').config.inputSchema.parse({ requestId: aid, message: 'task', role: 'owner' }));
assert.throws(() => a.server.tools.get('execute_my_brain_action').config.inputSchema.parse({ token: 'x', review: {}, confirmed: false }));
const start = brainCalls;
const ask = await a.call('ask_my_brain', { requestId: randomUUID(), message: 'task' });
assert.equal(ask.structuredContent.ok, true);
assert.equal(ask.structuredContent.actionExecuted, false);
assert.equal(db.tasks[0].status, 'open');
const retryInput = { requestId: randomUUID(), message: 'task' };
const prepared = await a.call('ask_my_brain', retryInput), replay = await a.call('ask_my_brain', retryInput);
assert.equal(brainCalls, start + 2); assert.equal(replay.structuredContent.replayed, true);
assert.deepEqual(replay.structuredContent.actions, prepared.structuredContent.actions);
const proposal = prepared.structuredContent.actions[0];
const execute = input => a.call('execute_my_brain_action', { token: proposal.executionToken, review: proposal.review, confirmed: true, ...input });
const edited = await execute({ review: { ...proposal.review, body: { status: 'dismissed' } } });
assert.equal(edited.structuredContent.ok, false); assert.equal(db.tasks[0].status, 'open');
const foreignToken = await b.call('execute_my_brain_action', { token: proposal.executionToken, review: proposal.review, confirmed: true });
assert.equal(foreignToken.structuredContent.ok, false); assert.equal(db.tasks[1].status, 'open');
const changedRole = await owner.call('execute_my_brain_action', { token: proposal.executionToken, review: proposal.review, confirmed: true });
assert.equal(changedRole.structuredContent.ok, false);
trustBlocked = true;
const blocked = await execute({}); assert.equal(blocked.structuredContent.ok, false); assert.equal(db.tasks[0].status, 'open');
trustBlocked = false;
const completed = await execute({});
assert.equal(completed.structuredContent.ok, true); assert.equal(db.tasks[0].status, 'done');
assert.equal(completed.structuredContent.receiptSavedInBrain, true);
assert.ok(db.assistant_messages.some(row => row.owner_id === alice && row.content.includes('Completed')));
const again = await execute({}); assert.equal(again.structuredContent.result.reused, true);
const executionId = completed.structuredContent.result.executionId;
const foreignReceipt = await b.call('get_my_brain_execution', { executionId }); assert.equal(foreignReceipt.structuredContent.ok, false);
const ownReceipt = await a.call('get_my_brain_execution', { executionId }); assert.equal(ownReceipt.structuredContent.execution.status, 'completed');
const ownUndo = await a.call('undo_my_brain_action', { executionId, review: ownReceipt.structuredContent.undoReview, confirmed: true });
assert.equal(ownUndo.structuredContent.ok, true); assert.equal(db.tasks[0].status, 'open');
const undoAgain = await a.call('undo_my_brain_action', { executionId, review: ownReceipt.structuredContent.undoReview, confirmed: true });
assert.equal(undoAgain.structuredContent.result.reused, true);
const staffAssign = await a.call('ask_my_brain', { requestId: randomUUID(), message: 'assign' });
assert.equal(staffAssign.structuredContent.actions[0].unavailable, true);
const forced = authority.signBrainAction({ scope: scope(), action: { type: 'assign_work', label: 'Assign', endpoint: '/api/crm/brain/assign-work', method: 'POST', body: { kind: 'task', recordId: aid, assignedToUserId: bob } } });
const forcedReview = { type: 'assign_work', label: 'Assign', endpoint: '/api/crm/brain/assign-work', method: 'POST', body: { kind: 'task', recordId: aid, assignedToUserId: bob }, risk: 'reversible_internal', estimatedCostGbp: 0 };
assert.equal((await a.call('execute_my_brain_action', { token: forced, review: forcedReview, confirmed: true })).structuredContent.ok, false);
const ownerAssign = await owner.call('ask_my_brain', { requestId: randomUUID(), message: 'assign' });
const ownerProposal = ownerAssign.structuredContent.actions[0];
assert.equal((await owner.call('execute_my_brain_action', { token: ownerProposal.executionToken, review: ownerProposal.review, confirmed: true })).structuredContent.ok, true);
assert.ok(rpcCalls.some(call => call.args.p_actor_user_id === alice && call.args.p_workspace_id === workspace && call.args.p_assigned_to_user_id === bob));
const email = await a.call('ask_my_brain', { requestId: randomUUID(), message: 'email' });
assert.equal(externalSends.length, 0);
const emailProposal = email.structuredContent.actions[0];
assert.equal(emailProposal.review.body.email, 'buyer@test.invalid');
assert.equal(emailProposal.review.body.body, 'Exact reviewed body');
const tamperedEmail = await a.call('execute_my_brain_action', { token: emailProposal.executionToken, review: { ...emailProposal.review, body: { ...emailProposal.review.body, email: 'evil@test.invalid' } }, confirmed: true });
assert.equal(tamperedEmail.structuredContent.ok, false); assert.equal(externalSends.length, 0);
const sent = await a.call('execute_my_brain_action', { token: emailProposal.executionToken, review: emailProposal.review, confirmed: true });
assert.equal(sent.structuredContent.ok, true); assert.equal(externalSends.length, 1); assert.equal(externalSends[0].userId, alice);
const fakeForeignTask = authority.signBrainAction({ scope: scope(), action: { type: 'update_task', label: 'Foreign task', endpoint: `/api/crm/tasks/${bid}`, method: 'PATCH', body: { status: 'done' } } });
const foreignTask = await a.call('execute_my_brain_action', { token: fakeForeignTask, review: { type: 'update_task', label: 'Foreign task', endpoint: `/api/crm/tasks/${bid}`, method: 'PATCH', body: { status: 'done' }, risk: 'reversible_internal', estimatedCostGbp: 0 }, confirmed: true });
assert.equal(foreignTask.structuredContent.ok, false); assert.equal(db.tasks[1].status, 'open');
const interrupted = await a.call('ask_my_brain', { requestId: randomUUID(), message: 'stream-error' }); assert.equal(interrupted.structuredContent.ok, false);
const outsideSession = session(alice, 'sales', outside);
assert.equal((await outsideSession.call('execute_my_brain_action', { token: proposal.executionToken, review: proposal.review, confirmed: true })).structuredContent.ok, false);
assert.equal(delegatedRequestScope(), null);
assert.ok(moduleLoads.includes('app/api/crm/tasks/[id]/route.ts'));
console.log('Brain MCP: original executor/task/undo/delegation handlers, concurrent user tokens, role and trust blocks, exact signed reviews, action replay, foreign records and receipts, paid/external approval metadata and interrupted streams passed. No provider messages sent.');

// Native history is explicitly account-scoped even with an RLS-free database.
const thread = compile('app/api/crm/assistant/thread/route.ts');
const clientThread = compile('app/api/crm/companies/[id]/assistant/route.ts');
for (const companyId of [null, aid]) for (const userId of [alice, bob]) db.assistant_messages.push({ id: randomUUID(), owner_id: userId, workspace_id: workspace, visibility: 'team', company_id: companyId, content: `${userId} personal answer`, role: 'assistant', created_at: stamp });
const request = new next.NextRequest('https://test.invalid/api/crm/assistant/thread');
for (const role of ['sales', 'owner']) {
  const global = await runWithDelegatedRequestScope(scope(alice, role), async () => (await thread.GET()).json());
  assert.ok(global.messages.length > 0);
  assert.ok(global.messages.every(row => !row.content.includes(bob)));
  const clientHistory = await runWithDelegatedRequestScope(scope(alice, role), async () => (await clientThread.GET(request, { params: { id: aid } })).json());
  assert.equal(clientHistory.messages.length, 1);
  assert.equal(clientHistory.messages[0].content, `${alice} personal answer`);
}
await runWithDelegatedRequestScope(scope(alice, 'owner'), () => thread.DELETE());
await runWithDelegatedRequestScope(scope(alice, 'owner'), () => clientThread.DELETE(request, { params: { id: aid } }));
assert.equal(db.assistant_messages.filter(row => row.owner_id === bob).length, 2);
const audit = compile('lib/brain-audit.ts');
await runWithDelegatedRequestScope(scope(), () => audit.logBrainAudit(scope(), { eventType: 'conversation_completed', correlationId: aid, status: 'completed', response: { reply: 'private reply', executionToken: 'never-store', nested: { authorization: 'never-store', token: 'never-store' } } }));
assert.equal(db.brain_audit_logs.at(-1).source, 'chatgpt');
assert.equal(db.brain_audit_logs.at(-1).response_payload.executionToken, '[redacted]');
assert.equal(db.brain_audit_logs.at(-1).response_payload.nested.token, '[redacted]');
assert.ok(db.brain_audit_logs.some(row => row.event_type === 'action_completed'));
assert.ok(db.brain_audit_logs.some(row => row.event_type === 'action_denied'));
assert.ok(db.brain_audit_logs.some(row => row.event_type === 'action_undone'));
assert.ok(db.brain_audit_logs.some(row => row.event_type === 'connector_failed'));
// The owner audit endpoint remains workspace-bound and expiry-filtered even
// without RLS. Staff are rejected before reading any audit table.
const auditApi = compile('app/api/crm/brain-audit/route.ts');
const auditRequest = new next.NextRequest('https://test.invalid/api/crm/brain-audit');
assert.equal((await runWithDelegatedRequestScope(scope(), () => auditApi.GET(auditRequest))).status, 403);
db.brain_audit_logs = [
 { id: aid, workspace_id: workspace, actor_user_id: bob, created_at: stamp, expires_at: new Date(Date.now() + 86400000).toISOString(), response_payload: { reply: 'audit copy' } },
 { id: bid, workspace_id: outside, actor_user_id: bob, created_at: stamp, expires_at: new Date(Date.now() + 86400000).toISOString() },
 { id: randomUUID(), workspace_id: workspace, actor_user_id: bob, created_at: stamp, expires_at: new Date(Date.now() - 86400000).toISOString() },
];
const auditResult = await runWithDelegatedRequestScope(scope(alice, 'owner'), async () => (await auditApi.GET(auditRequest)).json());
assert.equal(auditResult.logs.length, 1); assert.equal(auditResult.logs[0].id, aid);
const invalidCursor = new next.NextRequest('https://test.invalid/api/crm/brain-audit?cursor=bad|bad');
assert.equal((await runWithDelegatedRequestScope(scope(alice, 'owner'), () => auditApi.GET(invalidCursor))).status, 400);
const cron = compile('app/api/cron/brain-audit-retention/route.ts');
delete process.env.CRON_SECRET;
assert.equal((await cron.GET(auditRequest)).status, 401);
process.env.CRON_SECRET = 'test-cron';
assert.equal((await cron.GET(auditRequest)).status, 401);
const cronRequest = new next.NextRequest('https://test.invalid/api/cron/brain-audit-retention', { headers: { authorization: 'Bearer test-cron' } });
process.env.VERCEL_ENV = 'preview';
assert.equal((await (await cron.GET(cronRequest)).json()).skipped, 'preview');
process.env.VERCEL_ENV = 'production';
assert.equal((await cron.GET(cronRequest)).status, 200);
assert.ok(rpcCalls.some(call => call.name === 'prune_expired_brain_audits_service'));
console.log('Brain privacy and audit: native global/client read and clear isolation, owner boundary, credential redaction, owner-only audit scope/expiry and protected production retention passed.');
