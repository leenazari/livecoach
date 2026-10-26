import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { inferLink, deriveNewClientFromAttendees, shouldRepairStaleCalendarCompanyLink } from '../lib/attendee-linking.ts';
import { cachedIntentForCalendarAttendee, inheritVerifiedCalendarCompany, verifiedCalendarGroupIntent } from '../lib/calendar-call-identity.ts';
import { normaliseCompanyDomain } from '../lib/company-identity.ts';
import { markOwnCalendarAttendees } from '../lib/calendar-subject.ts';

const internalDomains = new Set(['ai13.com', 'interviewa.com', 'schoolofcoding.co.uk']);
const school = { id: 'school', domain: 'schoolofcoding.co.uk', name: 'School of Coding', profile: {} };
const internal = { id: 'internal', domain: 'interviewa.com', name: 'Interviewa', profile: { pipeline_exclusion: { active: true, reason: 'Internal company' } } };
const config = {
  internalDomains, internalCompanyId: null,
  contactEmailToCompany: new Map([['staff@interviewa.com', 'internal']]),
  companyByDomain: new Map([[school.domain, school.id], [internal.domain, internal.id]]),
  companyById: new Map([[school.id, school], [internal.id, internal]]),
};
const guests = [{ email: 'host@ai13.com', self: true }, { email: 'organizer@schoolofcoding.co.uk', organizer: true, displayName: 'Partner Organiser' }];
const event = { title: 'Catch up', attendees: guests };
assert.deepEqual(inferLink(guests, config, event), { companyId: 'school', isInternal: true });
assert.deepEqual(inferLink([...guests].reverse(), { ...config, internalCompanyId: 'internal' }, event), { companyId: 'school', isInternal: true }, 'Default internal company cannot replace the direct partner');
assert.equal(shouldRepairStaleCalendarCompanyLink(internal, guests, config), true);
assert.equal(shouldRepairStaleCalendarCompanyLink(school, guests, config), false);
assert.equal(inferLink([...guests, { email: 'staff@interviewa.com' }], config, event).companyId, null, 'Mixed protected organisations without a named lead need confirmation');
assert.equal(inferLink([...guests, { email: 'other@schoolofcoding.co.uk' }], config, event).companyId, 'school', 'One unambiguous partner organisation can contain several people');
assert.equal(inferLink([...guests, { email: 'buyer@external.test' }], config, event).companyId, null, 'Protected partner cannot replace the external buyer');
assert.equal(inferLink([{ email: 'staff@interviewa.com' }, { email: 'buyer@external.test' }], config, event).companyId, null, 'Known internal staff contact cannot become an outside client');
assert.equal(deriveNewClientFromAttendees([...guests, { email: 'buyer@external.test' }], config, event).domain, 'external.test');
assert.equal(inferLink(guests, { ...config, companyByDomain: new Map(), companyById: new Map() }, event).companyId, null, 'No cross-account company fallback');

const allowed = new Set(['school', 'internal']);
const wrongPrior = { title: 'Catch up', attendees: [{ email: 'someone@interviewa.com' }], company_id: 'internal' };
assert.equal(inheritVerifiedCalendarCompany(event, [wrongPrior], allowed), null);
assert.equal(inheritVerifiedCalendarCompany({ ...event, attendees: [] }, [{ ...wrongPrior, attendees: [] }], allowed), null);
const samePrior = { ...event, company_id: 'school' };
assert.equal(inheritVerifiedCalendarCompany(event, [samePrior, wrongPrior], allowed), 'school');
assert.equal(inheritVerifiedCalendarCompany(event, [samePrior, { ...samePrior, company_id: 'internal' }], allowed), null);
assert.equal(inheritVerifiedCalendarCompany(event, [samePrior], new Set(['internal'])), null, 'Inaccessible historical records are never inherited');
assert.equal(cachedIntentForCalendarAttendee(event, 'school', config, { intent: 'Wrong person' }), null);
assert.equal(cachedIntentForCalendarAttendee(event, 'school', config, { intent: 'Wrong person', basedOnLeadEmail: 'other@schoolofcoding.co.uk' }), null);
assert.equal(cachedIntentForCalendarAttendee(event, 'internal', config, { intent: 'Wrong client', basedOnLeadEmail: guests[1].email }), null);
assert.equal(cachedIntentForCalendarAttendee(event, 'school', config, { intent: 'Verified partner next step', basedOnLeadEmail: guests[1].email }), 'Verified partner next step');

function compile(relative, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, URL, Set, Map, console, AbortController, setTimeout, clearTimeout, process: { env: {} }, require: name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const NextResponse = { json: (data, init) => Response.json(data, init) };

// Failed identity reads cannot silently become an empty lookup. Duplicate
// contacts/domains are explicitly ambiguous, not last-row-wins or new clients.
async function loadConfigWith(errorTable) {
  const error = new Error('Identity lookup unavailable');
  const data = {
    workspace_profile: { internal_domains: [] },
    companies: [school, internal, { id: 'one', domain: 'duplicate.test' }, { id: 'two', domain: 'duplicate.test' }],
    contacts: [
      { email: 'shared@duplicate.test', company_id: 'one' },
      { email: 'shared@duplicate.test', company_id: 'two' },
      { email: 'known@duplicate.test', company_id: 'one' },
    ],
  };
  const module = compile('../lib/attendees.ts', {
    '@/lib/supabase': { supabaseAdmin: { from: table => {
      const query = { select() { return this; }, eq() { return this; }, not() { return this; }, maybeSingle() { return this; },
        then(resolve) { return Promise.resolve(resolve({ data: data[table], error: table === errorTable ? error : null })); } };
      return query;
    } } },
    '@/lib/workspace-profile': { ensureWorkspaceProfileId: async () => 'profile' },
    '@/lib/own-account-emails': { loadOwnAccountEmails: async () => new Set() },
    '@/lib/attendee-linking': { inferLink, deriveNewClientFromAttendees, shouldRepairStaleCalendarCompanyLink },
  });
  return module.loadAttendeeConfig();
}
for (const table of ['workspace_profile', 'companies', 'contacts']) {
  await assert.rejects(loadConfigWith(table), /Identity lookup unavailable/);
}
const ambiguous = await loadConfigWith();
assert.equal(ambiguous.companyByDomain.has('duplicate.test'), false);
assert.equal(ambiguous.contactEmailToCompany.has('shared@duplicate.test'), false);
assert.equal(inferLink([{ email: 'shared@duplicate.test' }], ambiguous).companyId, null);
assert.equal(deriveNewClientFromAttendees([{ email: 'shared@duplicate.test' }], ambiguous), null);
assert.equal(deriveNewClientFromAttendees([{ email: 'new@duplicate.test' }], ambiguous), null, 'Conflicting existing companies must not create another duplicate');
assert.equal(inferLink([{ email: 'known@duplicate.test' }], ambiguous).companyId, 'one', 'An unambiguous exact contact can disambiguate a shared company domain');

// Execute the actual sync endpoint for two users. Query filters are applied by
// the mock, not assumed, so missing owner/workspace constraints leak fixtures
// and fail these assertions. No provider, model, mail or live database is used.
async function runSync(owner) {
  const workspace = `workspace-${owner}`;
  const scope = { userId: owner, workspaceId: workspace };
  const stamp = new Date(Date.now() + 3600000).toISOString();
  const upcoming = [
    { id: 'prior', external_id: 'old', title: 'Catch up', attendees: wrongPrior.attendees, company_id: 'internal', created_at: '2026-01-01', owner_id: owner, workspace_id: workspace },
    { id: 'repair', external_id: 'repair', ...event, company_id: 'internal', intent: 'Wrong', intent_meta: { source: 'generated' }, scheduled_at: new Date(Date.parse(stamp) + 7200000).toISOString(), completed_at: null, owner_id: owner, workspace_id: workspace },
    { id: 'manual', external_id: 'manual', ...event, company_id: 'internal', intent: 'My explicit agenda', intent_meta: { source: 'manual' }, scheduled_at: new Date(Date.parse(stamp) + 10800000).toISOString(), completed_at: null, owner_id: owner, workspace_id: workspace },
    { id: 'other-user', external_id: 'new', ...event, company_id: 'private-other-client', scheduled_at: stamp, created_at: '2026-10-19', owner_id: 'another-user', workspace_id: workspace },
    { id: 'other-workspace', external_id: 'unknown', title: 'Unknown catch up', attendees: [{ email: 'person@gmail.com' }], company_id: 'private-other-workspace', scheduled_at: stamp, created_at: '2026-10-19', owner_id: owner, workspace_id: 'other-workspace' },
  ];
  const protectedBefore = JSON.stringify(upcoming.slice(-2));
  const tables = { upcoming_calls: upcoming, companies: [{ ...school, profile: { next_call: { intent: 'Unbound old agenda' } } }], calendar_event_exclusions: [] };
  const reads = [];
  const db = { from(table) {
    let where = [], write = null, projection = '';
    const query = {
      select(fields) { projection = fields; return this; },
      eq(k,v) { where.push([k,v]); return this; },
      in(k,v) { where.push([k, new Set(v)]); return this; },
      is(k,v) { where.push([k,v]); return this; },
      order() { return this; }, limit() { return this; },
      insert(value) { write = { insert: value }; return this; },
      update(value) { write = { update: value }; return this; },
      then(resolve) {
        let data;
        if (write?.insert) {
          data = (Array.isArray(write.insert) ? write.insert : [write.insert]).map((r,i) => ({ id: `inserted-${i}`, ...r }));
          tables[table].push(...data);
        } else {
          data = (tables[table] || []).filter(row => where.every(([k,v]) => v instanceof Set ? v.has(row[k]) : row[k] === v));
          if (write?.update) data.forEach(row => Object.assign(row, write.update));
        }
        reads.push({ table, where, projection });
        return Promise.resolve(resolve({ data: structuredClone(data), error: null }));
      },
    };
    return query;
  } };
  let claimed = false;
  const calendarEvents = [
    { id: 'new', ...event },
    { id: 'unknown', title: 'Unknown catch up', attendees: [{ email: 'host@ai13.com', self: true }, { email: 'person@gmail.com' }] },
    { id: 'repair', ...event }, { id: 'manual', ...event },
  ].map(e => ({ ...e, start: { dateTime: stamp }, meeting_url: 'https://meet.google.com/test-only' }));
  const endpoint = compile('../app/api/crm/calendar-sync/route.ts', {
    'next/server': { NextResponse },
    '@/lib/calendar-subject': { markOwnCalendarAttendees },
    '@/lib/google': { titleOf: e => e.title, meetingUrlOf: e => e.meeting_url },
    '@/lib/calendar-provider': { listConnectedCalendarSnapshot: async () => ({ source: 'google', provider: 'google', events: calendarEvents, complete: false }) },
    '@/lib/supabase': { supabaseAdmin: db, supabaseService: db },
    '@/lib/app-config': { setAppConfigValue: async () => {} },
    '@/lib/record-scope': { resolveRecordScope: async () => scope, privateRecordFields: s => ({ owner_id: s.userId, workspace_id: s.workspaceId, visibility: 'private' }) },
    '@/lib/attendees': { loadAttendeeConfig: async () => config, inferLink, deriveNewClientFromAttendees, shouldRepairStaleCalendarCompanyLink },
    '@/lib/outreach-crm': { loadOutreachProspectsForAttendees: async () => new Map(), matchOutreachProspectForAttendees: () => null },
    '@/lib/calendar-events': { isNonMeetingCalendarBlock: () => false },
    '@/lib/automation-accounts': {}, '@/lib/service-scope': {},
    '@/lib/calendar-sync-recovery': { shouldReopenScheduledCalendarCall: () => false },
    '@/lib/automatic-precall': { scheduleAutomaticNotetakersForUpcomingIds: async () => ({ eligible: 0, failed: 0 }) },
    '@/lib/recall-scheduled-bot': {}, '@vercel/functions': { waitUntil: () => {} },
    '@/lib/calendar-sync-jobs': { requestCalendarSync: async () => {}, claimCalendarSync: async () => claimed ? null : (claimed = true, { requested_mode: 'near-term' }), finishCalendarSync: async () => {} },
    '@/lib/calendar-watches': { ensureCalendarWatches: async () => ({}) },
    '@/lib/request-scope': { isVerifiedServiceRequest: () => false },
    '@/lib/calendar-call-identity': { cachedIntentForCalendarAttendee, inheritVerifiedCalendarCompany },
  });
  // Different slots avoid the unrelated same-title/time dedupe policy.
  calendarEvents.forEach((e,i) => { e.start.dateTime = new Date(Date.parse(stamp) + i * 3600000).toISOString(); });
  const response = await endpoint.POST({ nextUrl: new URL('https://test.local/api/crm/calendar-sync?mode=near-term') });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const fresh = upcoming.find(r => r.external_id === 'new' && r.owner_id === owner && r.workspace_id === workspace);
  assert.equal(fresh.company_id, 'school');
  assert.equal(fresh.intent, null, 'Company-wide unbound marketing agenda must not seed the new call');
  const unknown = upcoming.find(r => r.external_id === 'unknown' && r.workspace_id === workspace);
  assert.equal(unknown.company_id, null, 'No generic-title fallback or cross-workspace inheritance');
  assert.equal(upcoming.find(r => r.id === 'repair').company_id, 'school');
  assert.equal(upcoming.find(r => r.id === 'repair').intent, null);
  assert.equal(upcoming.find(r => r.id === 'manual').intent, 'My explicit agenda');
  assert.equal(upcoming.find(r => r.id === 'manual').company_id, 'internal');
  assert.equal(JSON.stringify(upcoming.filter(r => r.id.startsWith('other-'))), protectedBefore);
  const history = reads.find(r => r.table === 'upcoming_calls' && r.projection.includes('created_at'));
  assert.ok(history.where.some(([k,v]) => k === 'owner_id' && v === owner));
  assert.ok(history.where.some(([k,v]) => k === 'workspace_id' && v === workspace));
}
await runSync('lee');
await runSync('salesperson');

// Ambiguous scheduled-call identity must stop BEFORE reading company history,
// generating tokens, or applying an intent. Nonexistent and mismatched records
// retain their distinct errors.
for (const scenario of [
  { call: null, primaryAttendee: null, status: 404 },
  { call: { id: 'event', company_id: 'other' }, primaryAttendee: null, status: 409 },
  { call: { id: 'event', company_id: 'school' }, primaryAttendee: null, status: 200, unresolved: true },
  { call: { id: 'event', company_id: 'school', intent: 'My confirmed agenda', prep: { intentMeta: { source: 'manual' } } }, primaryAttendee: null, status: 200 },
]) {
  const endpoint = compile('../app/api/crm/companies/[id]/prep-intent/route.ts', {
    'next/server': { NextResponse }, '@/lib/supabase': { supabaseAdmin: { from: table => {
      assert.ok(['upcoming_calls', 'companies'].includes(table), 'Must not read unrelated company history');
      return { select(fields) { if (table === 'companies') assert.equal(fields, 'id,name,domain,website'); return this; },
        eq(key, value) { assert.equal(key, 'id'); assert.equal(value, table === 'companies' ? 'school' : 'event'); return this; },
        maybeSingle: async () => ({ data: table === 'companies' ? school : scenario.call, error: null }) };
    } } },
    '@/lib/openai': {}, '@/lib/usage': {}, '@/lib/commercial-memory': {}, '@/lib/workspace': {}, '@/lib/workstreams': {},
    '@/lib/call-subject': { loadPrimaryAttendeeForUpcoming: async () => scenario },
    '@/lib/calendar-call-identity': { verifiedCalendarGroupIntent },
    '@/lib/company-identity': { normaliseCompanyDomain },
  });
  const response = await endpoint.POST({ json: async () => ({ upcomingId: 'event' }) }, { params: { id: 'school' } });
  assert.equal(response.status, scenario.status);
  if (scenario.status === 200) {
    const body = await response.json();
    assert.equal(body.intent, scenario.unresolved ? '' : 'My confirmed agenda');
    if (scenario.unresolved) {
      assert.equal(body.needsIdentityConfirmation, true);
      assert.match(body.notice, /still open the meeting and start/);
      assert.equal(body.error, undefined, 'Prep uncertainty must not trigger an ownership blocker');
    }
  }
}

// Exercise actual prompt construction and timeout fallback. Another person's
// old company agenda must not become a deterministic fallback for this call.
for (const manual of [false, true]) {
  let modelRequest;
  const writes = [];
  const call = { company_id: 'school', title: 'Catch up', intent: manual ? 'My own Mo agenda' : 'Wrong old agenda', prep: { intentMeta: { source: manual ? 'manual' : 'generated' } } };
  const db = { from(table) {
    let update;
    return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, single() { return this; }, maybeSingle() { return this; },
      update(value) { update = value; return this; },
      then(resolve) {
        if (update) writes.push({ table, update });
        const data = table === 'companies' ? { name: 'School of Coding', profile: {} }
          : table === 'upcoming_calls' ? call
          : table === 'interview_summaries' ? [{ created_at: '2026-01-01', session_id: 'older', summary: { myNextActions: ['Plan another person\'s marketing launch'] } }] : [];
        return Promise.resolve(resolve({ data, error: null }));
      } };
  } };
  const endpoint = compile('../app/api/crm/companies/[id]/prep-intent/route.ts', {
    'next/server': { NextResponse }, '@/lib/supabase': { supabaseAdmin: db },
    '@/lib/openai': { openai: { messages: { create: async args => { modelRequest = args; return { content: [] }; } } } },
    '@/lib/usage': { logModelUsage: async () => {} },
    '@/lib/commercial-memory': { getCommercialMemory: async () => null, formatCommercialMemoryBlock: () => '' },
    '@/lib/workspace': { workspaceContextBlock: async () => '', getLessonsBlock: async () => '' },
    '@/lib/workstreams': { resolveCallScope: async () => ({ workstream: null }) },
    '@/lib/call-subject': { loadPrimaryAttendeeForUpcoming: async () => ({ call, primaryAttendee: { email: guests[1].email, name: 'Mo Reza' } }) },
    '@/lib/calendar-call-identity': { verifiedCalendarGroupIntent },
    '@/lib/company-identity': { normaliseCompanyDomain },
  });
  const response = await endpoint.POST({ json: async () => ({ upcomingId: 'event', force: true }) }, { params: { id: 'school' } });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(modelRequest.messages[0].content, /VERIFIED MEETING PERSON: Mo Reza/);
  assert.match(modelRequest.system, /Do not transfer another person's agenda/);
  assert.equal(body.fallback, true);
  assert.doesNotMatch(body.intent, /marketing launch|Wrong old agenda/);
  if (manual) {
    assert.equal(body.intent, 'My own Mo agenda');
    assert.equal(writes.some(w => w.table === 'upcoming_calls'), false);
  } else {
    assert.match(body.intent, /Mo Reza at School of Coding/);
    assert.equal(writes.find(w => w.table === 'upcoming_calls').update.prep.intentMeta.leadEmail, guests[1].email);
  }
}
console.log('Calendar partner identity, exact guest inheritance, cache binding, ambiguous lookups, manual intent, two-user isolation and prep endpoint checks passed');
