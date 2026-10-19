const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const workspaceId = '9961b7c1-413d-4c96-9bbd-64466ff9fe25';
const ids = Array.from({ length: 650 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
const requests = [];
let failNext = false;
const client = createClient('https://test.supabase.co', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (failNext || url.href.length > 8192) {
      failNext = false;
      return new Response(JSON.stringify({ message: 'Bad Request' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(url.searchParams.get('workspace_id'), `eq.${workspaceId}`);
    assert.equal(url.searchParams.get('is_confidential'), 'eq.false');
    assert.equal(url.searchParams.get('select'), 'id,classification:profile->triage->>classification,reviewedAt:profile->triage->>reviewedAt,archived:profile->archived');
    const batch = url.searchParams.get('id').slice(4, -1).split(',');
    assert.ok(batch.length <= 100);
    return new Response(JSON.stringify(batch.map(id => ({ id, classification: 'prospect', reviewedAt: '2026-10-19T14:30:00Z', archived: false }))), { headers: { 'Content-Type': 'application/json' } });
  } },
});
const moduleExports = {};
const source = ts.transpileModule(fs.readFileSync('lib/team-client-sharing.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(source, {
  exports: moduleExports,
  require: (name) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/supabase') return { supabaseService: client, supabaseAdmin: client };
    if (name === '@/lib/client-sharing-policy') return {};
    throw new Error(`Unexpected import: ${name}`);
  },
});
(async () => {
  const legacy = new URL('https://test.supabase.co/rest/v1/companies');
  legacy.searchParams.set('id', `in.(${ids.join(',')})`);
  assert.ok(legacy.href.length > 25000, 'The regression fixture must reproduce the rejected request size');
  const rows = await moduleExports.loadSafeSharedReviewFlags([...ids, ids[0], ''], workspaceId);
  assert.equal(rows.length, ids.length, 'Every client survives batching and deduplication');
  assert.equal(requests.length, 7);
  assert.equal(rows.at(-1).id, ids.at(-1), 'The final batch cannot be lost');
  assert.equal(rows.at(-1).reviewedAt, '2026-10-19T14:30:00Z');
  assert.equal(rows.at(-1).classification, 'prospect');
  assert.equal(rows.at(-1).archived, false);
  assert.equal(new Set(rows.map(row => row.id)).size, ids.length);
  assert.ok(requests.every(url => url.href.length < 8192));
  assert.equal((await moduleExports.loadSafeSharedReviewFlags([], workspaceId)).length, 0);
  assert.equal(requests.length, 7, 'Empty lists must not request an unfiltered table');
  failNext = true;
  await assert.rejects(moduleExports.loadSafeSharedReviewFlags(ids.slice(0, 1), workspaceId), error => error.message === 'Bad Request');
  const route = fs.readFileSync('app/api/crm/clients/portfolio/route.ts', 'utf8');
  assert.match(route, /loadSafeSharedReviewFlags\(sharedCompanyIds, scope.workspaceId\)/);
  assert.ok(!route.includes('.in("id", sharedCompanyIds)'), 'The portfolio must not reintroduce the oversized request');
  console.log('Large client review: 650 clients preserved across 7 bounded SDK requests; workspace, confidentiality, empty-list and failure checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
