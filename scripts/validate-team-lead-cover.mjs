import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
let scope = { userId: 'coverer', workspaceId: 'workspace', role: 'sales', status: 'active' };
const company = (id, extra = {}) => ({ id, workspace_id: 'workspace', owner_id: 'colleague', visibility: 'private', is_confidential: false, name: id, stage: 'New', notes: 'Sales note', profile: { secret: 'private intelligence' }, ...extra });
const db = {
  workspaces: [{ id: 'workspace', team_lead_cover_enabled: true }],
  workspace_members: ['coverer','colleague','third'].map(user_id => ({ user_id, workspace_id: 'workspace', status: 'active', role: 'sales' })),
  companies: [company('lead'), company('confidential', { is_confidential: true }), company('investor', { stage: 'Investor' }), company('internal', { profile: { triage: { classification: 'in_house' } } }), company('internal-flag', { profile: { internal: true } }), company('foreign', { workspace_id: 'elsewhere' })],
  opportunities: ['lead','confidential','investor','internal','foreign'].map(company_id => ({ id: `${company_id}-deal`, company_id, workspace_id: company_id === 'foreign' ? 'elsewhere' : 'workspace', owner_id: 'colleague', assigned_to_user_id: 'colleague', opportunity_type: 'revenue', visibility: 'private', status: 'open', pipeline_stage: 'new', value: 10 })),
  contacts: [{ id: 'contact', company_id: 'lead', workspace_id: 'workspace', owner_id: 'colleague', visibility: 'private', name: 'Buyer', email: 'buyer@example.test', attributes: { secret: true } }],
  client_context: [
    { id: 'manual', company_id: 'lead', workspace_id: 'workspace', owner_id: 'colleague', kind: 'note', source_ref: null, content: 'Asked for a demo', created_at: '2026-09-01' },
    { id: 'document', company_id: 'lead', workspace_id: 'workspace', owner_id: 'colleague', kind: 'doc', source_ref: null, content: 'Private document' },
    { id: 'imported', company_id: 'lead', workspace_id: 'workspace', owner_id: 'colleague', kind: 'note', source_ref: 'mailbox:123', content: 'Private mailbox' },
  ],
};
db.opportunities.push({ ...db.opportunities[0], id: 'strategic-deal', opportunity_type: 'strategic' });
class Query {
  constructor(table, service) { this.table = table; this.service = service; this.filters = []; this.fields = '*'; }
  select(fields = '*') { this.fields = fields; return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  is(key, value) { return this.eq(key, value); }
  not(key, op, value) { return this.neq(key, value); }
  order() { return this; }
  limit() { return this; }
  update(patch) { this.patch = patch; return this; }
  insert(row) { this.inserted = row; return this; }
  delete() { this.deleting = true; return this; }
  maybeSingle() { this.one = true; return this; }
  single() { return this.maybeSingle(); }
  async then(resolve, reject) {
    try {
      const table = db[this.table] ||= [];
      if (this.inserted) table.push({ id: `new-${table.length}`, created_at: '2026-09-11', source_ref: null, ...(this.service ? {} : { owner_id: scope.userId, workspace_id: scope.workspaceId }), ...this.inserted });
      let rows = table.filter(row => this.filters.every(test => test(row)));
      if (!this.service) rows = rows.filter(row => row.workspace_id === scope.workspaceId && (this.table === 'workspace_members' || row.owner_id === scope.userId || row.visibility === 'team'));
      if (this.inserted) rows = [table.at(-1)];
      if (this.patch) rows.forEach(row => Object.assign(row, this.patch));
      if (this.deleting) db[this.table] = table.filter(row => !rows.includes(row));
      const projected = rows.map(row => this.fields === '*' ? { ...row } : Object.fromEntries(this.fields.split(',').map(field => field.trim()).map(field => [field, row[field]])));
      return resolve({ data: this.one ? projected[0] || null : projected, error: null });
    } catch (error) { return reject(error); }
  }
}
const supabaseAdmin = { from: table => new Query(table, false) };
const supabaseService = { from: table => new Query(table, true) };
const stubs = {
  'server-only': {},
  '@/lib/supabase': { supabaseAdmin, supabaseService },
  '@/lib/request-scope': { requireRequestScope: () => scope, getRequestScope: () => scope },
  '@/lib/commercial-memory': { getCommercialMemory: async () => null },
  '@/lib/crm-blocker': { crmBlockerPayload: value => value },
  '@/lib/job-research-sources': { verifiedCompanyResearchEvidence: () => ({}), verifiedJobResearchEvidence: () => ({}) },
  '@/lib/company-resolver': { resolveExistingCompany: async () => null },
  '@/lib/openai': {}, '@/lib/usage': {}, '@/lib/activity-intelligence': {}, '@/lib/opportunity-signals': {},
  '@/app/api/crm/companies/[id]/activity/approve/route': {},
};
const modules = new Map();
function load(name) {
  if (Object.hasOwn(stubs, name)) return stubs[name];
  if (!name.startsWith('@/')) return require(name);
  const file = path.join(root, name.slice(2) + '.ts');
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', source)(load, module, module.exports);
  return module.exports;
}
const cover = load('@/lib/team-lead-cover');
const access = load('@/lib/opportunity-access');
const companies = load('@/app/api/crm/companies/[id]/route');
const opportunities = load('@/app/api/crm/opportunities/[id]/route');
const contacts = load('@/app/api/crm/contacts/[id]/route');
const context = load('@/app/api/crm/companies/[id]/context/route');
const activity = load('@/app/api/crm/companies/[id]/activity/route');
const req = body => ({ json: async () => ({ ...body }) });
const params = id => ({ params: { id } });
assert.deepEqual((await cover.loadTeamLeadCoverCompanies(scope)).map(row => row.id), ['lead']);
for (const userId of ['coverer', 'third']) {
  scope = { ...scope, userId };
  const response = await companies.GET(req({}), params('lead'));
  assert.equal(response.status, 200);
  const opened = await response.json();
  assert.equal(opened.access.canEdit, true);
  assert.equal(opened.access.assignedToUserId, 'colleague');
  assert.equal(opened.company.notes, 'Sales note');
  assert.deepEqual(opened.company.profile, {});
  assert.equal(opened.contacts[0].name, 'Buyer');
  assert.equal(opened.contacts[0].attributes, undefined);
  assert.equal((await opportunities.PATCH(req({ value: 25, pipelineStage: 'qualified', assignedToUserId: 'colleague' }), params('lead-deal'))).status, 200);
  assert.equal(db.opportunities[0].assigned_to_user_id, 'colleague');
  assert.equal(db.opportunities[0].owner_id, 'colleague');
  assert.equal(db.opportunities[0].value, 25);
  assert.equal(db.opportunities[0].last_change_context.actorUserId, userId);
  assert.equal((await opportunities.PATCH(req({ assignedToUserId: userId }), params('lead-deal'))).status, 403);
  assert.equal((await opportunities.DELETE(req({}), params('lead-deal'))).status, 403);
}
assert.equal((await companies.PATCH(req({ notes: 'Updated sales note' }), params('lead'))).status, 200);
assert.equal(db.companies[0].notes, 'Updated sales note');
assert.equal((await contacts.PATCH(req({ role: 'Decision maker' }), params('contact'))).status, 200);
assert.equal(db.contacts[0].owner_id, 'colleague');
assert.equal((await contacts.PATCH(req({ companyId: 'foreign' }), params('contact'))).status, 403);
assert.equal((await activity.POST(req({ channel: 'note', content: 'Holiday cover update' }), params('lead'))).status, 200);
const items = (await (await context.GET(req({}), params('lead'))).json()).items;
assert.ok(items.some(row => row.content === 'Holiday cover update'));
assert.ok(items.some(row => row.id === 'manual'));
assert.ok(!items.some(row => ['document','imported'].includes(row.id)));
assert.deepEqual((await access.loadVisibleOpportunities(scope)).map(row => row.id), ['lead-deal']);
for (const id of ['confidential','investor','internal','foreign']) {
  assert.equal((await companies.PATCH(req({ stage: 'Demo', canTeamEdit: true }), params(id))).status, 404);
  assert.equal((await opportunities.PATCH(req({ value: 999, canTeamEdit: true }), params(`${id}-deal`))).status, 404);
}
assert.equal((await opportunities.PATCH(req({ value: 999 }), params('strategic-deal'))).status, 404);
db.workspaces[0].team_lead_cover_enabled = false;
assert.equal((await companies.PATCH(req({ stage: 'Demo' }), params('lead'))).status, 404);
assert.equal((await opportunities.PATCH(req({ value: 999 }), params('lead-deal'))).status, 404);
db.workspaces[0].team_lead_cover_enabled = true;
db.workspace_members.find(row => row.user_id === scope.userId).status = 'suspended';
assert.deepEqual(await cover.loadTeamLeadCoverCompanies(scope), []);
scope = { ...scope, workspaceId: 'elsewhere' };
assert.deepEqual(await cover.loadTeamLeadCoverCompanies(scope), []);
console.log('PASS: actual CRM handlers allow colleague lead, contact, note and deal updates; ownership stays fixed; takeover, deletion, disabled cover, inactive membership, confidential/non-sales and foreign records remain blocked.');
