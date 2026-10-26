import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as calendar from '../lib/calendar-subject.ts';
import { cachedIntentForCalendarAttendee } from '../lib/calendar-call-identity.ts';

const invite = [
  { email: 'host@ai13.com', self: true },
  { email: 'jay@ai13.com', displayName: 'Jay Support', organizer: true, responseStatus: 'accepted' },
  { email: 'buyer@customer.example', displayName: 'Robin Buyer', responseStatus: 'needsAction' },
];
for (const attendees of [invite, [...invite].reverse()]) {
  for (const context of [
    { title: 'Jay Support client introduction' },
    { title: 'Catch up', contactEmails: ['jay@ai13.com'], companyDomain: 'ai13.com' },
    { title: 'Meeting with jay@ai13.com' },
  ]) assert.equal(calendar.pickPrimaryAttendee(attendees, context)?.email, 'buyer@customer.example',
    'A supporting colleague must be excluded before title, contact or company scoring');
}
const ambiguous = [...invite, { email: 'other@second.example' }];
assert.equal(calendar.pickPrimaryAttendee(ambiguous, { title: 'Jay Support client introduction' }), null,
  'An internal name cannot resolve ambiguity between external leads');
assert.equal(calendar.pickPrimaryAttendee(invite.slice(0, 2), { title: 'Jay Support internal planning' })?.email,
  'jay@ai13.com', 'A genuinely internal meeting can still select its named colleague');
assert.equal(calendar.pickPrimaryAttendee([
  invite[0], { email: 'support@schoolofcoding.co.uk' }, invite[2],
], { title: 'support@schoolofcoding.co.uk introduction' })?.email, 'buyer@customer.example');
assert.equal(calendar.pickPrimaryAttendee([
  invite[0], { email: 'support@custom.internal' }, invite[2],
], { title: 'support@custom.internal introduction', internalDomains: ['HTTPS://CUSTOM.INTERNAL/'] })?.email,
  'buyer@customer.example', 'Configured internal domains use the same exclusion rule');
assert.equal(cachedIntentForCalendarAttendee({ title: 'Jay Support introduction', attendees: invite }, 'customer', {
  internalDomains: new Set(['ai13.com']), contactEmailToCompany: new Map([['jay@ai13.com', 'customer']]),
  companyById: new Map([['customer', { id: 'customer', domain: 'customer.example' }]]),
}, { intent: 'Unrelated internal agenda', basedOnLeadEmail: 'jay@ai13.com' }), null);

function compile(relative, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Set, Map, console, require(name) {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const ids = {
  company: '10000000-0000-4000-8000-000000000001',
  upcoming: '10000000-0000-4000-8000-000000000002',
  colleagueThread: '10000000-0000-4000-8000-000000000003',
  buyerThread: '10000000-0000-4000-8000-000000000004',
  manualThread: '10000000-0000-4000-8000-000000000005',
  privateThread: '10000000-0000-4000-8000-000000000006',
};

// Run the actual scope resolver against an account-bound database mock. These
// fixtures deliberately put the colleague on the client's contact list too.
async function run(owner, scenario = {}) {
  const workspace = `workspace-${owner}`;
  const bound = row => ({ owner_id: owner, workspace_id: workspace, ...row });
  const call = bound({ id: ids.upcoming, company_id: ids.company, workstream_id: scenario.saved || null,
    title: scenario.internal ? 'Jay Support internal planning' : 'Jay Support introduction',
    attendees: scenario.internal ? invite.slice(0, 2) : scenario.ambiguous ? ambiguous : invite });
  const tables = {
    upcoming_calls: [call],
    contacts: [bound({ id: 'jay', company_id: ids.company, email: 'jay@ai13.com' }),
      ...(scenario.buyer ? [bound({ id: 'buyer', company_id: ids.company, email: 'buyer@customer.example' })] : []),
      bound({ id: 'other-user-buyer', owner_id: 'someone-else', company_id: ids.company, email: 'buyer@customer.example' }),
      bound({ id: 'other-workspace-buyer', workspace_id: 'other-workspace', company_id: ids.company, email: 'buyer@customer.example' })],
    workstream_contacts: [
      bound({ contact_id: 'jay', company_id: ids.company, workstream_id: ids.colleagueThread }),
      bound({ contact_id: 'buyer', company_id: ids.company, workstream_id: ids.buyerThread }),
      bound({ contact_id: 'other-user-buyer', owner_id: 'someone-else', company_id: ids.company, workstream_id: ids.privateThread }),
      bound({ contact_id: 'other-workspace-buyer', workspace_id: 'other-workspace', company_id: ids.company, workstream_id: ids.privateThread }),
    ],
    workstreams: Object.values(ids).filter(id => ![ids.company, ids.upcoming].includes(id)).map(id =>
      bound({ id, company_id: ids.company, status: 'active', name: id, purpose: '', kind: 'sales' })),
  };
  const writes = [];
  const linkedContactIds = [];
  let leadReads = 0;
  const module = compile('../lib/workstreams.ts', {
    '@/lib/call-subject': { resolvePrimaryAttendeeForCall: async actual => {
      leadReads += 1;
      assert.equal(actual.id, ids.upcoming);
      assert.equal(actual.title, call.title);
      if (scenario.failure) throw new Error('Identity unavailable');
      return calendar.pickPrimaryAttendee(actual.attendees, { title: actual.title });
    } },
    '@/lib/supabase': { supabaseAdmin: { from(table) {
      const where = [];
      let patch;
      const query = { select() { return this; }, eq(k,v) { where.push(row => row[k] === v); return this; },
        is(k,v) { return this.eq(k,v); }, in(k,v) {
          if (table === 'workstream_contacts' && k === 'contact_id') linkedContactIds.push(...v);
          where.push(row => v.includes(row[k])); return this;
        }, maybeSingle() { this.single = true; return this; },
        update(value) { patch = value; return this; }, then(resolve) {
          const matches = (tables[table] || []).filter(row => row.owner_id === owner && row.workspace_id === workspace && where.every(test => test(row)));
          if (patch) { writes.push({ table, patch, ids: matches.map(row => row.id) }); matches.forEach(row => Object.assign(row, patch)); }
          return Promise.resolve(resolve({ data: this.single ? matches[0] || null : matches, error: null }));
        } };
      return query;
    } } },
  });
  const promise = module.resolveCallScope({ companyId: ids.company, upcomingId: ids.upcoming,
    ...(scenario.manual ? { workstreamId: ids.manualThread } : {}),
    ...(scenario.confirmed !== undefined ? { leadEmail: scenario.confirmed } : {}) });
  if (scenario.failure) {
    await assert.rejects(promise, /Identity unavailable/);
    assert.equal(writes.length, 0);
    return;
  }
  const result = await promise;
  const expected = scenario.saved || (scenario.manual ? ids.manualThread : scenario.internal ? ids.colleagueThread
    : scenario.buyer && !scenario.ambiguous && scenario.confirmed !== '' ? ids.buyerThread : null);
  assert.equal(result.workstream?.id || null, expected, JSON.stringify(scenario));
  assert.equal(result.companyId, ids.company);
  if (!scenario.internal) assert.ok(!linkedContactIds.includes('jay'), 'Internal supporters never select an external client thread');
  assert.ok(!linkedContactIds.some(id => id.startsWith('other-')), 'Other accounts and workspaces stay excluded');
  if (scenario.manual || scenario.saved || scenario.confirmed !== undefined) assert.equal(leadReads, 0);
  if (!expected || scenario.manual || scenario.saved) assert.equal(writes.length, 0);
  else assert.equal(call.workstream_id, expected, 'The canonical call stores only the verified lead thread');
}
for (const user of ['owner', 'salesperson']) {
  for (const scenario of [{}, { buyer: true }, { ambiguous: true }, { confirmed: '' },
    { buyer: true, confirmed: 'buyer@customer.example' }, { internal: true }, { manual: true, buyer: true },
    { saved: ids.manualThread, buyer: true }, { failure: true }]) await run(user, scenario);
}
console.log('Supporting attendees cannot steer call identity, cached intent or client threads. Internal meetings, manual choices, ambiguity and two-user isolation passed.');
