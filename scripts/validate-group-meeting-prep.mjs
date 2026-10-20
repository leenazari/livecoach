import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { verifiedCalendarGroupIntent } from '../lib/calendar-call-identity.ts';
import { normaliseCompanyDomain } from '../lib/company-identity.ts';
import { refreshCallPrepContext } from '../lib/call-prep-refresh.ts';
import { pickPrimaryAttendee } from '../lib/calendar-subject.ts';

const company = { id: 'school', name: 'School of Coding & AI', domain: 'schoolofcoding.co.uk' };
const event = {
  id: 'group-call', company_id: 'school', title: 'Project timetable review',
  attendees: [
    { email: 'host@ai13.com', self: true },
    ...Array.from({ length: 8 }, (_, i) => ({
      email: `person${i + 1}@schoolofcoding.co.uk`,
      organizer: i === 7, responseStatus: i === 7 ? 'accepted' : 'needsAction',
    })),
  ],
  intent: null, prep: null,
};
assert.equal(pickPrimaryAttendee(event.attendees, { title: event.title, companyDomain: company.domain }), null);
const group = verifiedCalendarGroupIntent(event, company);
assert.equal(group.attendeeEmails.length, 8);
assert.match(group.intent, /Project timetable review/);
assert.match(group.intent, /School of Coding & AI team/);
assert.doesNotMatch(group.intent, /person8|sales interview|marketing launch/i);
assert.deepEqual(verifiedCalendarGroupIntent({ ...event, attendees: [...event.attendees].reverse() }, company), group);
for (const changed of [
  { company_id: 'wrong' },
  { title: '' },
  { attendees: [] },
  { attendees: [{ email: 'a@schoolofcoding.co.uk' }, { email: 'a@schoolofcoding.co.uk' }] },
  { attendees: [...event.attendees, { email: 'staff@interviewa.com' }] },
  { attendees: [...event.attendees, { email: 'buyer@external.test' }] },
  { attendees: [...event.attendees, { displayName: 'Unknown guest' }] },
]) assert.equal(verifiedCalendarGroupIntent({ ...event, ...changed }, company), null);
assert.equal(verifiedCalendarGroupIntent({ ...event, attendees: [{ email: 'one@gmail.com' }, { email: 'two@gmail.com' }] }, { ...company, domain: 'gmail.com' }), null);

const code = ts.transpileModule(readFileSync(new URL('../app/api/crm/companies/[id]/prep-intent/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the actual route with account-scoped storage. The group path may read
// only the current call and company identity, never another person's history.
for (const owner of ['lee', 'kam']) {
  for (const scenario of ['fresh', 'manual', 'race', 'company-race', 'save-failure', 'other-owner', 'other-workspace']) {
    const workspace = `${owner}-workspace`;
    const row = { ...structuredClone(event), owner_id: owner, workspace_id: workspace };
    if (scenario === 'manual') {
      row.intent = 'My personally confirmed timetable agenda';
      row.prep = { intentMeta: { source: 'manual' }, selectedComps: ['My focus'] };
    }
    const before = structuredClone(row);
    const outsider = { ...structuredClone(row), id: 'private-call', owner_id: 'other', intent: 'Private investor meeting' };
    const otherWorkspace = { ...structuredClone(row), id: 'other-workspace-call', workspace_id: 'other-workspace', intent: 'Private partner meeting' };
    const rows = [row, outsider, otherWorkspace];
    let writes = 0;
    let raceInjected = false;
    const db = { from(table) {
      assert.ok(['companies', 'upcoming_calls'].includes(table), `No history/model scope for group meeting: ${table}`);
      let filters = [], patch;
      const query = {
        select(fields) {
          if (table === 'companies') assert.equal(fields, 'id,name,domain,website');
          return this;
        },
        eq(key, value) { filters.push([key, value]); return this; },
        is(key, value) { filters.push([key, value]); return this; },
        update(value) {
          assert.equal(table, 'upcoming_calls');
          patch = value;
          if (!raceInjected && scenario === 'race') {
            row.intent = 'Manual edit made during preparation';
            row.prep = { intentMeta: { source: 'manual' }, selectedComps: ['New focus'] };
            raceInjected = true;
          }
          if (scenario === 'company-race') row.company_id = 'another-company';
          return this;
        },
        async maybeSingle() {
          if (table === 'companies') return { data: company, error: null };
          if (patch && scenario === 'save-failure') return { data: null, error: new Error('Save failed') };
          const found = rows.find(candidate => candidate.owner_id === owner && candidate.workspace_id === workspace &&
            filters.every(([key, value]) => {
              const actual = ['attendees', 'prep'].includes(key) && value !== null ? JSON.stringify(candidate[key]) : candidate[key];
              return actual === value;
            }));
          if (found && patch) { Object.assign(found, patch); writes++; }
          return { data: found ? structuredClone(found) : null, error: null };
        },
      };
      return query;
    } };
    const exports = {};
    const deps = {
      'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
      '@/lib/supabase': { supabaseAdmin: db },
      '@/lib/openai': {}, '@/lib/usage': {}, '@/lib/commercial-memory': {}, '@/lib/workspace': {}, '@/lib/workstreams': {},
      '@/lib/calendar-call-identity': { verifiedCalendarGroupIntent },
      '@/lib/company-identity': { normaliseCompanyDomain },
      '@/lib/call-subject': { loadPrimaryAttendeeForUpcoming: async id => ({
        call: structuredClone(rows.find(r => r.id === id && r.owner_id === owner && r.workspace_id === workspace) || null),
        primaryAttendee: null,
      }) },
    };
    vm.runInNewContext(code, { exports, Date, console, require: name => {
      assert.ok(name in deps, `Unexpected dependency ${name}`);
      return deps[name];
    } });
    const requestedId = scenario === 'other-owner' ? outsider.id : scenario === 'other-workspace' ? otherWorkspace.id : row.id;
    const run = () => exports.POST({ json: async () => ({ upcomingId: requestedId }) }, { params: { id: company.id } });
    const response = await run();
    const body = await response.json();
    assert.equal(response.status, scenario === 'save-failure' ? 500 : scenario.startsWith('other-') ? 404 : 200, JSON.stringify(body));
    if (scenario === 'fresh') {
      assert.equal(body.intent, group.intent);
      assert.equal(body.groupMeeting, true);
      assert.equal(writes, 1);
      assert.equal(row.prep.intentMeta.basis, 'verified_company_group');
      assert.deepEqual(row.prep.intentMeta.attendeeEmails, group.attendeeEmails);
      const reopened = await (await run()).json();
      assert.equal(reopened.intent, body.intent);
      assert.equal(reopened.cached, true);
      assert.equal(writes, 1, 'Reopening does not reprocess an unchanged group meeting');
    } else if (scenario === 'manual') {
      assert.equal(body.intent, before.intent);
      assert.equal(body.manual, true);
      assert.deepEqual(row, before);
    } else {
      assert.equal(writes, 0);
      if (scenario === 'race' || scenario === 'company-race') {
        assert.equal(body.needsIdentityConfirmation, true);
        if (scenario === 'race') assert.equal(row.intent, 'Manual edit made during preparation');
      }
    }
    assert.equal(outsider.intent, 'Private investor meeting');
    assert.equal(otherWorkspace.intent, 'Private partner meeting');
  }
}
let requests = 0;
const refreshed = await refreshCallPrepContext(async url => {
  assert.match(url, /prep-intent$/);
  requests++;
  return { intent: group.intent, groupMeeting: true, notice: 'Group meeting confirmed' };
}, { ...event, primaryAttendee: null });
assert.equal(requests, 1, 'No arbitrary attendee email is pulled for a group');
assert.equal(refreshed.notice, 'Group meeting confirmed');
const unresolved = await refreshCallPrepContext(async () => ({ intent: '', needsIdentityConfirmation: true, notice: 'Confirm identity' }), { ...event, primaryAttendee: null });
assert.equal(unresolved.needsIdentityConfirmation, true);
// The scheduled refresh uses the same response contract and must not report a
// successful intent refresh when the caller still needs to confirm identity.
const cron = readFileSync(new URL('../app/api/cron/precall-email-context/route.ts', import.meta.url), 'utf8');
const resultStart = cron.indexOf('          const intentResult = await intentResponse.json();');
assert.ok(resultStart > 0);
const resultEnd = cron.indexOf('\n        } catch', resultStart);
const countRefresh = new Function('intentResponse',
  `return (async () => { let intentsRefreshed = 0; ${cron.slice(resultStart, resultEnd)} return intentsRefreshed; })();`);
for (const [data, expected] of [
  [{ intent: group.intent }, 1],
  [{ intent: '', needsIdentityConfirmation: true }, 0],
  [{ intent: ' ', needsIdentityConfirmation: false }, 0],
]) assert.equal(await countRefresh(Response.json(data)), expected);
assert.equal(await countRefresh(Response.json({ error: 'not found' }, { status: 404 })), 0);
console.log('Group meeting prep, exact invite, no history/mail guessing, manual edits, concurrent saves, cache and two-user isolation passed');
