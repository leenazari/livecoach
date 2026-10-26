import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as calendar from '../lib/calendar-subject.ts';
import { inferLink, deriveNewClientFromAttendees } from '../lib/attendee-linking.ts';
import { cachedIntentForCalendarAttendee } from '../lib/calendar-call-identity.ts';
import { normaliseCompanyDomain } from '../lib/company-identity.ts';
import * as leadContext from '../lib/call-lead-context.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function compile(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console, Set, Map, Date, URL, require(name) {
    if (name === 'server-only') return {};
    if (name in deps) return deps[name];
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}

// Reproduce the invitation with the host's personal login also invited.
const invite = [
  { email: 'alex.owner@gmail.com', responseStatus: 'accepted' },
  { email: 'robin@vendor.example', organizer: true },
  { email: 'alex@ai13.com', self: true },
  { email: 'colleague@interviewa.com' },
];
const title = '30-minute meeting with Robin Contact (Alex Owner)';
const selfEmails = new Set(['alex.owner@gmail.com', 'alex@ai13.com', 'alex@interviewa.com']);
const config = {
  selfEmails, internalDomains: new Set(['ai13.com', 'interviewa.com']), internalCompanyId: 'internal',
  contactEmailToCompany: new Map([['alex.owner@gmail.com', 'internal'], ['robin@vendor.example', 'vendor']]),
  companyByDomain: new Map([['vendor.example', 'vendor']]),
  companyById: new Map([['vendor', { id: 'vendor', domain: 'vendor.example' }]]),
};
assert.equal(calendar.pickPrimaryAttendee(invite, { title })?.email, 'alex.owner@gmail.com', 'Fixture must reproduce the old bug without owner identity');
for (const attendees of [invite, [...invite].reverse()]) {
  assert.equal(calendar.pickPrimaryAttendee(attendees, { title, selfEmails })?.email, 'robin@vendor.example');
  assert.equal(inferLink(attendees, config, { title }).companyId, 'vendor');
  assert.equal(deriveNewClientFromAttendees(attendees, config, { title }).email, 'robin@vendor.example');
  assert.equal(cachedIntentForCalendarAttendee({ title, attendees }, 'vendor', config, { intent: 'Wrong internal agenda', basedOnLeadEmail: 'alex.owner@gmail.com' }), null);
}
assert.equal(invite[0].self, undefined, 'Normalising must not mutate a provider snapshot');
assert.equal(calendar.markOwnCalendarAttendees([{ email: '  ALEX.OWNER@GMAIL.COM ' }], selfEmails)[0].self, true);
assert.equal(calendar.pickPrimaryAttendee([{ email: 'buyer@gmail.com' }, invite[0]], { title: 'Buyer meeting', selfEmails })?.email, 'buyer@gmail.com', 'Other personal mailbox users remain legitimate guests');
assert.equal(calendar.pickPrimaryAttendee([invite[0]], { title, selfEmails }), null);
assert.equal(calendar.pickPrimaryAttendee([{ email: 'a@outside.test' }, { email: 'b@outside.test' }, invite[0]], { title: 'Catch up', selfEmails }), null, 'Ambiguous external guests still need confirmation');

// Execute the real identity loader. Apply filters instead of assuming scoping.
async function loadOwn(userId, { status = 'active', errorTable, absentMember = false } = {}) {
  const workspaceId = `workspace-${userId}`;
  const reads = [];
  const rows = {
    workspace_members: absentMember ? [] : [{ user_id: userId, workspace_id: workspaceId, status }],
    profiles: [{ user_id: userId, email: `${userId}@gmail.com`, outreach_sender_email: `${userId}@sender.test` }, { user_id: 'other', email: 'private@other.test' }],
    google_oauth: [{ owner_id: userId, workspace_id: workspaceId, email: `${userId}@calendar.test` }, { owner_id: userId, workspace_id: 'other-workspace', email: 'private@workspace.test' }],
    microsoft_oauth: [{ owner_id: userId, workspace_id: workspaceId, email: `${userId}@outlook.com` }, { owner_id: 'other', workspace_id: workspaceId, email: 'private@other.test' }],
  };
  const loader = compile('lib/own-account-emails.ts', {
    '@/lib/record-scope': { resolveRecordScope: async explicit => {
      if (explicit && explicit !== userId) throw new Error('Cross-account record access is not permitted');
      return { userId, workspaceId };
    } },
    '@/lib/supabase': { supabaseService: { from(table) {
      const where = [];
      return { select(fields) { assert.doesNotMatch(fields, /token|secret|\*/); return this; },
        eq(key, value) { where.push([key, value]); return this; },
        async maybeSingle() {
          reads.push({ table, where });
          const matches = rows[table].filter(row => where.every(([key, value]) => row[key] === value));
          assert.ok(matches.length <= 1, `Unscoped ${table} read`);
          return { data: matches[0] || null, error: table === errorTable ? new Error('Identity read failed') : null };
        } };
    } } },
  });
  await assert.rejects(loader.loadOwnAccountEmails('other'), /Cross-account/);
  try {
    return await loader.loadOwnAccountEmails(userId);
  } finally {
    if (status !== 'active' || absentMember || errorTable === 'workspace_members') {
      assert.deepEqual(reads.map(r => r.table), ['workspace_members'], 'Membership failure stops all private identity reads');
    }
  }
}
for (const user of ['lee', 'kam']) {
  assert.deepEqual([...await loadOwn(user)].sort(), [`${user}@gmail.com`, `${user}@sender.test`, `${user}@calendar.test`, `${user}@outlook.com`].sort());
}
for (const status of ['onboarding', 'suspended', 'removed']) await assert.rejects(loadOwn('lee', { status }), /not active/);
await assert.rejects(loadOwn('lee', { absentMember: true }), /not active/);
for (const errorTable of ['workspace_members', 'profiles', 'google_oauth', 'microsoft_oauth']) await assert.rejects(loadOwn('lee', { errorTable }), /Identity read failed/);

const resolver = compile('lib/call-subject.ts', {
  '@/lib/call-lead-context': leadContext,
  '@/lib/company-identity': { normaliseCompanyDomain }, '@/lib/calendar-subject': calendar,
  '@/lib/own-account-emails': { loadOwnAccountEmails: async () => selfEmails },
  '@/lib/workspace-profile': { ensureWorkspaceProfileId: async () => 'profile' },
  '@/lib/supabase': { supabaseAdmin: { from(table) {
    return { select() { return this; }, eq() { return this; }, not() { return this; }, limit() { return this; }, maybeSingle() { return this; }, then(resolve) {
      return Promise.resolve(resolve({ error: null, data: table === 'workspace_profile' ? { internal_domains: ['ai13.com', 'interviewa.com'] }
        : table === 'companies' ? { name: 'Internal team', domain: 'ai13.com', profile: {} }
          : [{ name: 'Alex Owner', email: 'alex.owner@gmail.com' }] }));
    } };
  } } },
});
assert.equal((await resolver.resolvePrimaryAttendeeForCall({ id: 'event', title, attendees: invite, company_id: 'wrong-old-link' })).email, 'robin@vendor.example', 'A stale saved self-contact cannot replace the real external guest');
assert.equal((await resolver.resolvePrimaryAttendeeForCall({ id: 'unlinked', title: 'Colleague introduction', attendees: invite })).email,
  'robin@vendor.example', 'An unlinked call must also exclude the named internal colleague before matching');

// Real email endpoint rejects self before mailbox search, model calls or writes.
let searched = false;
const emailPull = compile('app/api/crm/email-pull/route.ts', {
  'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  '@/lib/record-scope': { resolveRecordScope: async () => ({ userId: 'lee', workspaceId: 'workspace-lee' }) },
  '@/lib/own-account-emails': { loadOwnAccountEmails: async () => selfEmails },
  '@/lib/supabase': { supabaseAdmin: { from() { throw new Error('Unexpected database access'); } } },
  '@/lib/mail': { recentMessages: async () => { searched = true; return []; } },
  '@/lib/crm-blocker': { crmBlockerPayload: value => value },
  '@/lib/company-resolver': {}, '@/lib/company-identity': {}, '@/lib/openai': {}, '@/lib/usage': {}, crypto: {},
  '@/lib/workstreams': {}, '@/lib/call-subject': {}, '@/lib/calendar-subject': {}, '@/lib/assigned-client-access': {},
});
const response = await emailPull.POST({ json: async () => ({ email: 'ALEX.OWNER@GMAIL.COM' }) });
assert.equal(response.status, 409);
assert.equal((await response.json()).code, 'email_target_is_self');
assert.equal(searched, false);
const page = read('app/call/page.tsx');
assert.match(page, /if \(cid && cname && !upcoming\) handleLinkCompany/);
assert.match(page, /if \(intent && !upcoming\) setBrief/);
console.log('Host aliases, correct attendee and client, cache binding, private two-user identities, inactive/read failures, self-email rejection and canonical call links passed');
