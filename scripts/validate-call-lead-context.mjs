import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as leadContext from '../lib/call-lead-context.ts';
import * as calendar from '../lib/calendar-subject.ts';
import { refreshCallPrepContext } from '../lib/call-prep-refresh.ts';
import { normaliseCompanyDomain } from '../lib/company-identity.ts';
import { crmBlockerPayload } from '../lib/crm-blocker.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function compile(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console, Date, Set, Map, require(name) {
    if (name === 'server-only') return {};
    if (name in deps) return deps[name];
    throw new Error(`Missing dependency ${name}`);
  } });
  return exports;
}

const guests = [{ email: 'robin@vendor.test', name: 'Robin' }, { email: 'pat@vendor.test', name: 'Pat' }];
const call = { id: 'call', company_id: 'company', attendees: guests, title: 'Catch up with Pat', prep: {
  intentMeta: { source: 'manual', leadEmail: guests[0].email, savedAt: '2026-01-01',
    emailSource: { companyId: 'company', provider: 'gmail', subject: 'Outbound offer', threadId: 'thread' } },
  focusBasisEmailContext: 'Discuss the supplier outbound pilot offer',
} };
const oldGuess = { ...guests[1], matchedBy: 'meeting_title' };
const resolve = (record = call, candidates = guests) => leadContext.resolveCallLeadContext(record, candidates, oldGuess);
assert.equal(resolve().primaryAttendee.email, guests[0].email, 'Exact meeting email outranks a title guess');
assert.equal(resolve().primaryAttendee.matchedBy, 'verified_email');
assert.equal(resolve().meetingEmail.subject, 'Outbound offer');
assert.equal(resolve(call, [guests[1]]).primaryAttendee, null, 'Missing email counterparty requires confirmation');
const manual = { ...call, prep: { ...call.prep, leadSelection: { email: guests[1].email, source: 'manual', companyId: 'company', savedAt: 'version' } } };
assert.equal(resolve(manual).primaryAttendee.email, guests[1].email, 'Human choice wins over the selected email');
assert.equal(resolve(manual).meetingEmail, null, 'Email for the previous lead is not carried over');
assert.equal(resolve({ ...manual, company_id: 'other' }).primaryAttendee, null, 'Client changes invalidate a saved choice');
assert.equal(resolve(manual, [guests[0]]).needsLeadConfirmation, true);
assert.equal(leadContext.verifiedCallEmail({ ...call, company_id: 'other' }), null);
assert.equal(leadContext.verifiedCallEmail({ ...call, prep: { ...call.prep, intentMeta: { source: 'generated', leadEmail: guests[0].email } } }), null);
assert.equal(leadContext.resolveCallLeadContext({ prep: {} }, guests, null).needsLeadConfirmation, true);
const snapshot = leadContext.preserveCallLeadMetadata(manual.prep, { leadSelection: { email: 'forged@bad.test' }, intentMeta: { emailSource: {} }, focusBasisEmailContext: 'Wrong history', privateNotes: ['Keep my words'] });
assert.equal(snapshot.leadSelection.email, guests[1].email);
assert.equal(snapshot.intentMeta.emailSource.threadId, 'thread');
assert.equal(snapshot.focusBasisEmailContext, call.prep.focusBasisEmailContext);
assert.deepEqual(snapshot.privateNotes, ['Keep my words']);
assert.equal(leadContext.preserveCallLeadMetadata({}, { leadSelection: {}, intentMeta: {} }).leadSelection, undefined);

let emailRequests = 0;
const refreshed = await refreshCallPrepContext(async url => {
  assert.match(url, /prep-intent$/); emailRequests++; return { intent: 'Evaluate the outbound offer' };
}, { ...call, ...resolve() });
assert.equal(emailRequests, 1, 'Pinned source reuses structured evidence without a broader mailbox/model pull');
assert.equal(refreshed.mail.emailContext, call.prep.focusBasisEmailContext);
assert.equal((await refreshCallPrepContext(() => { throw new Error('No request expected'); }, { id: 'unlinked', needsLeadConfirmation: true })).needsIdentityConfirmation, true);

// Execute the resolver against protected/self attendees, including an unlinked
// meeting. Neither calendar order nor an email source can promote a colleague.
const resolver = compile('lib/call-subject.ts', {
  '@/lib/company-identity': { normaliseCompanyDomain }, '@/lib/calendar-subject': calendar,
  '@/lib/call-lead-context': leadContext,
  '@/lib/own-account-emails': { loadOwnAccountEmails: async () => new Set(['host@gmail.com']) },
  '@/lib/workspace-profile': { ensureWorkspaceProfileId: async () => 'profile' },
  '@/lib/supabase': { supabaseAdmin: { from(table) {
    return { select() { return this; }, eq() { return this; }, not() { return this; }, limit() { return this; }, maybeSingle() { return this; }, then(resolve) {
      return Promise.resolve(resolve({ error: null, data: table === 'workspace_profile' ? { internal_domains: ['ai13.com'] }
        : table === 'companies' ? { name: 'Vendor', domain: 'vendor.test', profile: {} } : [] }));
    } };
  } } },
});
for (const company_id of ['company', null]) {
  const resolved = await resolver.resolveCallLead({ ...call, company_id,
    attendees: [...guests, { email: 'jay@ai13.com' }, { email: 'host@gmail.com' }],
  });
  assert.deepEqual(Array.from(resolved.leadChoices, choice => choice.email).sort(), guests.map(g => g.email).sort());
}
const internal = await resolver.resolveCallLead({ id: 'internal', title: 'Jay catch up', attendees: [{ email: 'jay@ai13.com' }] });
assert.equal(internal.primaryAttendee.email, 'jay@ai13.com', 'Direct internal meetings remain supported');

// Execute the real endpoint with owner/workspace filtering and compare-and-set.
for (const owner of ['owner-a', 'owner-b']) {
  for (const scenario of ['save', 'manual', 'invalid', 'supporting', 'other-owner', 'other-workspace', 'inactive', 'read-error', 'save-error', 'race']) {
    const row = { ...structuredClone(call), owner_id: owner, workspace_id: 'workspace', workstream_id: 'old-thread', intent: 'Old generated agenda',
      prep: { privateNotes: ['Keep private notes'], selectedComps: ['Old focus'], intentMeta: { source: scenario === 'manual' ? 'manual' : 'generated' } } };
    const original = structuredClone(row);
    let writes = 0;
    if (scenario === 'other-owner') row.owner_id = 'someone-else';
    if (scenario === 'other-workspace') row.workspace_id = 'other';
    const db = { from(table) {
      assert.equal(table, 'upcoming_calls');
      let filters = [], patch;
      return { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, is(k, v) { return this.eq(k, v); },
        update(value) { patch = value; if (scenario === 'race') row.prep = { newUserEdit: true }; return this; },
        async maybeSingle() {
          if (scenario === 'read-error' || (patch && scenario === 'save-error')) return { data: null, error: new Error('private database error') };
          const matches = filters.every(([k, v]) => (typeof row[k] === 'object' && row[k] !== null ? JSON.stringify(row[k]) : row[k]) === v);
          if (!matches) return { data: null, error: null };
          if (patch) { Object.assign(row, patch); writes++; }
          return { data: structuredClone(row), error: null };
        } };
    } };
    const endpoint = compile('app/api/crm/upcoming/[id]/lead/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/supabase': { supabaseAdmin: db }, '@/lib/record-scope': { resolveRecordScope: async () => ({ userId: owner, workspaceId: 'workspace' }) },
      '@/lib/call-subject': { resolveCallLead: async record => {
        if (scenario === 'inactive') throw new Error('Workspace account is not active');
        return leadContext.resolveCallLeadContext(record, guests, oldGuess);
      } }, '@/lib/crm-blocker': { crmBlockerPayload },
    });
    const response = await endpoint.POST({ json: async () => ({ leadEmail: scenario === 'invalid' ? '' : scenario === 'supporting' ? 'jay@ai13.com' : guests[0].email }) }, { params: { id: 'call' } });
    const body = await response.json();
    if (['save', 'manual'].includes(scenario)) {
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(writes, 1);
      assert.equal(row.prep.leadSelection.email, guests[0].email);
      assert.equal(resolve(row).primaryAttendee.email, guests[0].email, 'Choice survives a subsequent read');
      assert.deepEqual(Array.from(row.prep.privateNotes), original.prep.privateNotes);
      assert.equal(row.workstream_id, null);
      assert.equal(row.prepped, false);
      assert.equal(row.intent, scenario === 'manual' ? original.intent : null);
    } else {
      assert.equal(body.ok, undefined);
      assert.ok(response.status >= 400);
      assert.equal(writes, 0);
      assert.doesNotMatch(body.error, /private database/);
      assert.ok(body.blocker.nextAction);
    }
  }
}
const page = read('app/call/page.tsx');
const route = read('app/api/crm/upcoming/[id]/route.ts');
assert.match(page, /<MeetingLeadPicker/);
assert.match(page, /leadSelectionVersion: meetingLead\?\.leadSelectionVersion/);
assert.match(route, /body.prep.leadSelectionVersion !== currentPrep.leadSelection.savedAt/);
assert.match(route, /saveQuery.eq\("prep", JSON.stringify\(current.prep\)\)/);
assert.match(page, /Your lead was saved, but the updated prep could not be loaded/);
console.log('Email-first lead identity, human overrides, stale choices, structured source reuse, two-user saves, exclusions, failures and concurrent edits passed');
