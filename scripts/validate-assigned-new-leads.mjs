import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as projection from '../lib/assigned-new-leads.ts';
import { sheetLeadMapping, leadCompanyName } from '../lib/lead-sheet-import.ts';
import { sharedClientBlockReason } from '../lib/client-sharing-policy.ts';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compile = (file, deps) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, console, URL, Set, Map, Date, require: name => { if (name === 'server-only') return {}; if (name in deps) return deps[name]; throw new Error(name); } });
  return exports;
};
const source = { spreadsheetId: 'test-sheet', sheetId: '12', row: 2 };
const members = [{ user_id: 'kam', display_name: 'Kamm', status: 'active' }];
const mapped = sheetLeadMapping({ company: 'Example Ltd (Example Group), London, 20 staff', owner: 'Kamm', website: 'https://www.example.test', contact: 'Alice Example', 'Email address': 'info@example.test', 'decision maker email': 'secret@ignored.test', 'demo link': 'https://demo.test/one?p=exact', 'why Adam fits': 'OMIT_I', 'suggested opener': 'OMIT_J', 'email body': 'OMIT_R', 'DM email body': 'OMIT_W', 'Emails sent (dates)': '19 Nov 2026', status: 'contacted' }, source, members);
assert.equal(mapped.companyName, 'Example Ltd'); assert.equal(mapped.email, 'info@example.test');
assert.equal(mapped.assignedTo, 'kam'); assert.equal(mapped.importedLead.emailHistory, '19 Nov 2026');
assert.equal(mapped.importedLead.holdingPageUrl, 'https://demo.test/one?p=exact');
assert.doesNotMatch(JSON.stringify(mapped), /OMIT_|secret@ignored/);
assert.equal(mapped.sourceRef, sheetLeadMapping({ company: 'Example Ltd', owner: 'Kamm', website: 'https://example.test' }, { ...source, row: 99 }, members).sourceRef, 'Row reorder must not create another lead');
assert.throws(() => sheetLeadMapping({ company: 'Example', owner: 'Someone' }, source, members), /owner/);
assert.throws(() => sheetLeadMapping({ company: 'Example', owner: 'Kamm' }, source, [{ ...members[0], status: 'removed' }]), /owner/);
assert.throws(() => sheetLeadMapping({ company: 'Example', owner: 'Kamm' }, source, [...members, { ...members[0], user_id: 'other' }]), /owner/);
assert.equal(leadCompanyName('Car, Van & Minibus World (CVM), Stoke'), 'Car, Van & Minibus World');
assert.equal(projection.safeLeadUrl('javascript:alert(1)'), '');
assert.equal(projection.safeLeadUrl('https://user:pass@host.test'), '');
assert.equal(projection.importedLeadStatus('contacted', 'Do not email again'), 'on_hold');
assert.equal(projection.importedLeadStatus('not interested'), 'not_interested');

let viewer = { workspaceId: 'workspace', userId: 'kam', role: 'sales', status: 'active' };
const company = (id, overrides = {}) => ({ id, workspace_id: 'workspace', name: id, is_confidential: false, imported_lead: { ...mapped.importedLead, contactIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], notes: 'Permitted source notes' }, profile: { private: 'HIDDEN_PROFILE' }, notes: 'HIDDEN_NOTES', email_context: 'HIDDEN_EMAIL', ...overrides });
const share = (company_id, user = 'kam', overrides = {}) => ({ company_id, workspace_id: 'workspace', status: 'active', assigned_to_user_id: user, ...overrides });
const db = {
  workspace_members: ['kam', 'sharon', 'lee', 'nikhara'].map(user_id => ({ user_id, workspace_id: 'workspace', role: user_id === 'lee' ? 'owner' : 'sales', status: 'active' })),
  team_client_shares: [share('kam-lead'), share('sharon-lead', 'sharon'), share('nikhara-lead', 'nikhara'), share('confidential'), share('investor'), share('internal'), share('archived'), share('revoked', 'kam', { status: 'revoked' }), share('foreign', 'kam', { workspace_id: 'foreign' })],
  companies: [company('kam-lead'), company('sharon-lead'), company('nikhara-lead'), company('confidential', { is_confidential: true }), company('investor', { classification: 'investor' }), company('internal', { internal: true }), company('archived', { archived: true }), company('revoked'), company('foreign', { workspace_id: 'foreign' })],
  profiles: ['kam', 'sharon', 'lee', 'nikhara'].map(user_id => ({ user_id, display_name: user_id })),
  contacts: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: 'kam-lead', workspace_id: 'workspace', name: 'Alice', role: 'Buyer', email: 'alice@example.test', phone: '012345', notes: 'HIDDEN_CONTACT', attributes: { private: 'HIDDEN_ATTRIBUTES' } }],
};
let failTable = '', reads = [];
class Query {
  constructor(table) { this.table = table; this.filters = []; this.start = 0; this.end = Infinity; }
  select(fields) { assert.ok(!fields.includes('*')); this.fields = fields; return this; }
  eq(key, value) { this.filters.push(r => r[key] === value); return this; }
  in(key, values) { this.filters.push(r => values.includes(r[key])); return this; }
  contains(key, value) { assert.equal(key, 'attributes'); assert.equal(value.importedLead.version, 1); this.filters.push(r => r.imported_lead?.version === 1); return this; }
  order() { return this; }
  range(start, end) { this.start = start; this.end = end; return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve) { reads.push(this.table); const data = db[this.table].filter(r => this.filters.every(f => f(r))).slice(this.start, this.end + 1); return Promise.resolve({ data: this.single ? data[0] || null : data, error: this.table === failTable ? new Error('read failed') : null }).then(resolve); }
}
const loader = compile('lib/assigned-new-leads-server.ts', {
  '@/lib/supabase': { supabaseService: { from: table => new Query(table) } },
  '@/lib/request-scope': { requireRequestScope: () => viewer },
  '@/lib/client-sharing-policy': { sharedClientBlockReason }, '@/lib/assigned-new-leads': projection,
});
for (const id of ['kam', 'sharon', 'nikhara']) {
  viewer = { ...viewer, userId: id };
  const result = await loader.loadAssignedNewLeads();
  assert.deepEqual(Array.from(result.leads, l => l.id), [`${id}-lead`]);
  assert.doesNotMatch(JSON.stringify(result), /HIDDEN_/);
}
viewer = { ...viewer, userId: 'kam', role: 'owner' };
assert.equal((await loader.loadAssignedNewLeads()).leads.length, 1, 'Stale owner claim cannot grant broad access');
assert.equal((await loader.loadAssignedNewLeads('sharon-lead')).leads.length, 0, 'Company ID cannot bypass assignment');
viewer = { ...viewer, userId: 'lee' };
assert.equal((await loader.loadAssignedNewLeads()).leads.length, 3, 'Verified owner sees all ordinary assigned leads');
viewer = { ...viewer, userId: 'kam', workspaceId: 'foreign' };
await assert.rejects(loader.loadAssignedNewLeads(), /Active membership/);
viewer = { ...viewer, workspaceId: 'workspace' };
for (const status of ['removed', 'suspended', 'onboarding']) {
  db.workspace_members[0].status = status; reads = [];
  await assert.rejects(loader.loadAssignedNewLeads(), /Active membership/);
  assert.deepEqual(reads, ['workspace_members']);
}
db.workspace_members[0].status = 'active';
for (const table of ['workspace_members', 'team_client_shares', 'companies', 'contacts', 'profiles']) {
  failTable = table; await assert.rejects(loader.loadAssignedNewLeads(), /read failed/);
}
failTable = '';
const route = compile('app/api/crm/new-leads/route.ts', {
  'next/server': { NextResponse: { json: (data, options) => ({ data, ...options }) } },
  '@/lib/crm-blocker': { crmBlockerPayload: value => ({ error: value.title, blocker: value }) },
  '@/lib/assigned-new-leads': projection, '@/lib/assigned-new-leads-server': loader,
});
const req = query => ({ nextUrl: new URL(`https://crm.test/api/crm/new-leads?${query}`) });
assert.equal((await route.GET(req('page=-1'))).status, 400);
assert.equal((await route.GET(req('status=invalid'))).status, 400);
assert.equal((await route.GET(req('owner=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))).status, 403);
const response = await route.GET(req('search=kam'));
assert.equal(response.data.total, 1); assert.equal(response.data.pageSize, 25);
assert.equal(response.headers['Cache-Control'], 'private, no-store');
assert.match(read('components/crm/AssignedNewLeads.tsx'), /Open demo page/);
assert.doesNotMatch(read('lib/assigned-new-leads-server.ts'), /email_context|commercial_memory|select\(['"]\*/);
console.log('Assigned new leads passed. Canonical contacts and assignment, owner-only team view, two-user and marketing isolation, inactive and foreign denial, hidden fields, revoked shares, protected relationships, safe URLs, deterministic mapping and filters.');
