import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { refreshCallPrepContext } from '../lib/call-prep-refresh.ts';

// The request must finish the mailbox refresh before the intent endpoint runs.
for (const owner of ['lee', 'kam']) {
  const call = { id: `${owner}-call`, company_id: `${owner}-company`, workstream_id: `${owner}-thread`, primaryAttendee: { email: `${owner}@buyer.test` }, prep: { selectedComps: ['Old focus'] } };
  const requests = [];
  let mailSaved = false;
  const result = await refreshCallPrepContext(async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.upcomingId, call.id);
    requests.push(url);
    if (url.endsWith('email-pull')) {
      assert.equal(body.companyId, call.company_id);
      assert.equal(body.workstreamId, call.workstream_id);
      assert.equal(body.email, call.primaryAttendee.email);
      await Promise.resolve();
      mailSaved = true;
      return { ok: true, created: false, cached: true, emailContext: `${owner} latest email` };
    }
    assert.equal(mailSaved, true);
    return { intent: `${owner} fresh intent` };
  }, call);
  assert.equal(result.intent, `${owner} fresh intent`);
  assert.equal(result.mail.emailContext, `${owner} latest email`);
  assert.equal(requests.length, 2, 'Saved focus must not bypass refresh');
  let attempts = 0;
  await assert.rejects(refreshCallPrepContext(async () => {
    attempts++;
    throw new Error('Other account or mailbox unavailable');
  }, call), /Other account/);
  assert.equal(attempts, 1, 'Do not generate intent after failed email access');
}

// Execute the actual page callbacks with controlled closure values. This catches
// stale React state being used after an asynchronous email/intent refresh.
const page = readFileSync(new URL('../app/call/page.tsx', import.meta.url), 'utf8');
function callback(name, next, bindings) {
  const start = page.indexOf(`  const ${name} = useCallback(`);
  const end = page.indexOf(next, start);
  const code = ts.transpileModule(`${page.slice(start, end)}\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), 'useCallback', code)(...Object.values(bindings), fn => fn);
}
const ref = current => ({ current });
let planned, status, contextLoads = 0;
const noop = () => {};
const bindings = {
  intentLoading: false, prepping: false, brief: 'Outdated intent',
  setPrepping: noop, setMeterOn: noop, setStatus: value => { status = value; },
  upcomingIdRef: ref('lee-call'), intentEditedRef: ref(false),
  crmFetch: async () => ({ call: { id: 'lee-call' } }),
  refreshPrepContext: async () => ({ intent: 'Latest email intent', emailContext: 'Fresh buyer reply' }),
  loadContext: async () => { contextLoads++; },
  generatePlan: async (mode, context) => { planned = { mode, context }; return { ok: true }; },
  focusBasisBriefRef: ref('Outdated intent'), focusBasisEmailRef: ref('Old email'),
  setPrepContextChanged: noop, setPlanStage: noop, docsAtFocusRef: ref(0),
  loadedDocsCountRef: ref(0), setNewDocFlag: noop,
};
let prep = callback('prep', '  const persistSession =', bindings);
await prep('refocus');
assert.equal(planned.context.intent, 'Latest email intent');
assert.equal(planned.context.emailContext, 'Fresh buyer reply');
planned = null;
await prep('full');
assert.equal(planned, null, 'A stale focus cannot be used to build a full plan');
assert.match(status, /Rebuild and review/);
bindings.intentEditedRef.current = true;
await prep('refocus');
assert.equal(planned.context.intent, 'Outdated intent', 'Explicit user edits are preserved');
bindings.refreshPrepContext = async () => { throw new Error('Mailbox unavailable'); };
planned = null;
prep = callback('prep', '  const persistSession =', bindings);
await prep('focus');
assert.equal(planned, null);
assert.match(status, /Mailbox unavailable/);
assert.doesNotMatch(page, /call\?\.company_id && !call\?\.prep\?\.selectedComps/);
assert.match(page, /brief: planIntent \|\| null/);
assert.match(page, /\$\{planEmailContext.trim\(\)\}/);
console.log('Call prep email refresh ordering, planner handoff, saved focus, manual intent, and failure checks passed');
let plannerBody;
const generate = callback('generatePlan', '\n\n  const prep =', {
  brief: 'Old render intent', role: '', clientEmailCtx: 'Old render email',
  focusBasisBriefRef: ref('Old render intent'), focusBasisEmailRef: ref('Old render email'),
  aiCallsRef: ref(0), linkedCompanyRef: ref({ id: 'lee-company' }),
  linkedWorkstreamRef: ref({ id: 'lee-thread' }), suggestedCompsRef: ref(['Old focus']),
  candidateRef: ref('Buyer'), knowledgeRef: ref('History'), backgroundRef: ref(''),
  fetch: async (_url, options) => { plannerBody = JSON.parse(options.body); throw new Error('captured request'); },
});
await assert.rejects(generate('refocus', { intent: 'New intent', emailContext: 'New email' }), /captured request/);
assert.equal(plannerBody.brief, 'New intent');
assert.match(plannerBody.knowledgeContext, /New email/);
assert.doesNotMatch(plannerBody.knowledgeContext, /Old render email/);
assert.equal(plannerBody.existingFocus, undefined, 'Changed email must replace stale focus, not merge it');
assert.equal(plannerBody.companyId, 'lee-company');
assert.equal(plannerBody.workstreamId, 'lee-thread');
console.log('Actual planner request uses refreshed values instead of stale React closure');
for (const owner of ['lee', 'kam']) {
  const writes = [];
  const scoped = {
    refreshCallPrepContext: async () => ({ intent: `${owner} intent`, mail: { emailContext: `${owner} email` } }),
    crmFetch: noop, upcomingIdRef: ref(`${owner}-call`), linkedCompanyRef: ref({ id: `${owner}-company` }),
    linkedWorkstreamRef: ref({ id: `${owner}-thread` }), clientEmailCtxRef: ref(''),
    emailEditedRef: ref(false), emailRefreshVersionRef: ref(0),
    setClientEmailCtx: v => writes.push(v), setEmailCtxUpdatedAt: noop,
    setEmailPullNote: noop, intentEditedRef: ref(false), setBrief: v => writes.push(v),
    suggestedCompsRef: ref([]), focusBasisEmailRef: ref(''), focusBasisBriefRef: ref(''), setPrepContextChanged: noop,
  };
  const refresh = callback('refreshPrepContext', '  // Restore a prep plan', scoped);
  await refresh({ id: `${owner}-call`, company_id: `${owner}-company`, workstream_id: `${owner}-thread` });
  assert.deepEqual(writes, [`${owner} email`, `${owner} intent`]);
  writes.length = 0;
  await assert.rejects(refresh({ id: 'other-call', company_id: 'other-company', workstream_id: 'other-thread' }), /call changed/);
  assert.deepEqual(writes, [], 'A late response for another call cannot populate this screen');
}
console.log('Two-user and cross-call late-response isolation checks passed');
