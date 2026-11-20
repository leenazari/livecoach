import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function load(file, deps, timer = setTimeout) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'setTimeout', code)(deps, module, module.exports, timer);
  return module.exports;
}

let responses=[], calls=[];
const { syncCalendarAndWait } = load('lib/calendar-sync-client.ts', name => {
  assert.equal(name, '@/lib/crm');
  return { crmFetch: async (url, options) => {
    calls.push({url, method:options?.method || 'GET'});
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, 'Every request must have a test response');
    return response;
  }};
}, callback => callback());
responses=[{added:1,reconciled:true}];
assert.deepEqual(await syncCalendarAndWait(), {added:1,reconciled:true});
assert.equal(calls.length,1,'A finished sync needs no polling');
calls=[];
responses=[{queued:true}, {state:'pending'}, {state:'complete',finishedAt:'2026-11-20T16:45:00Z'}];
assert.deepEqual(await syncCalendarAndWait(), {queued:false,backgroundCompleted:true,finishedAt:'2026-11-20T16:45:00Z'});
assert.equal(calls.filter(call=>call.method==='POST').length,1,'Never retry the provider mutation while waiting');
assert.equal(calls.filter(call=>call.url==='/api/crm/calendar-sync/status').length,2);
for (const failure of [{state:'failed',message:'Update needs attention'}, {state:'unknown'}, new Error('network unavailable')]) {
  responses=[{queued:true},failure]; calls=[];
  await assert.rejects(syncCalendarAndWait());
  assert.equal(calls.filter(call=>call.method==='POST').length,1);
}
responses=[{queued:true},...Array.from({length:20},()=>({state:'pending'}))]; calls=[];
const timeout=await syncCalendarAndWait();
assert.equal(timeout.queued,true,'An unconfirmed sync must never become success');
assert.match(timeout.warning,/still running/);
assert.equal(calls.length,21,'Polling is bounded');

let scope={userId:'sharon',workspaceId:'sales-team',status:'active'};
let dbError=false, reads=[];
const rows=[
  {owner_id:'sharon',workspace_id:'sales-team',requested_version:2,completed_version:1,completed_at:'2026-11-20T16:00:00Z',last_error:null},
  {owner_id:'lee',workspace_id:'sales-team',requested_version:5,completed_version:5,completed_at:'2026-11-20T16:45:00Z',last_error:null},
  {owner_id:'sharon',workspace_id:'other-team',requested_version:9,completed_version:9,completed_at:'2026-11-20T16:50:00Z',last_error:null},
];
const db={from(table) {
  assert.equal(table,'calendar_sync_jobs');
  const filters=[]; reads.push(filters);
  return {
    select(fields) { assert.doesNotMatch(fields,/token|owner_id|workspace_id/); return this; },
    eq(key,value) {filters.push([key,value]); return this;},
    async maybeSingle() {return {data:rows.find(row=>filters.every(([key,value])=>row[key]===value))||null,error:dbError?new Error('private db details'):null};},
  };
}};
const { GET }=load('app/api/crm/calendar-sync/status/route.ts',name=> {
  if(name==='@/lib/request-scope') return {getRequestScope:()=>scope};
  if(name==='@/lib/supabase') return {supabaseService:db};
  if(name==='@/lib/crm-blocker') return {crmBlockerPayload:value=>value};
  return require(name);
});
assert.equal((await (await GET()).json()).state,'pending','Sharon cannot inherit Lee or another workspace completed state');
assert.deepEqual(reads[0],[['workspace_id','sales-team'],['owner_id','sharon']]);
scope={...scope,userId:'lee'};
const leeResponse=await GET();
assert.equal((await leeResponse.json()).state,'complete');
assert.match(leeResponse.headers.get('cache-control'),/private, no-store/);
scope={...scope,userId:'missing'};
assert.equal((await (await GET()).json()).state,'unknown');
for(const status of ['onboarding','suspended','removed']) {
  scope={...scope,status};
  const count=reads.length;
  assert.equal((await GET()).status,403);
  assert.equal(reads.length,count,'Inactive membership must never read a job');
}
scope=null;
assert.equal((await GET()).status,403);
scope={userId:'sharon',workspaceId:'sales-team',status:'active'};
rows[0].last_error='private provider error';
const failed=await (await GET()).json();
assert.equal(failed.state,'failed');
assert.doesNotMatch(JSON.stringify(failed),/private provider/);
rows[0].leased_until=new Date(Date.now()+60000).toISOString();
assert.equal((await (await GET()).json()).state,'pending','A retry in flight must not display its previous failure');
dbError=true;
const failedRead=await GET();
assert.equal(failedRead.status,503);
assert.doesNotMatch(await failedRead.text(),/private db details/);

for(const file of ['components/InitialCalendarSync.tsx','components/crm/UpcomingCalls.tsx','app/crm/inbox/page.tsx']) {
  assert.match(read(file),/syncCalendarAndWait\(\)/);
}
assert.match(read('app/crm/inbox/page.tsx'),/await syncCalendarAndWait\(\);[\s\S]*?await load\(true\);[\s\S]*?setFilter\("calls"\)/);
assert.match(read('app/crm/inbox/page.tsx'),/if \(result\.queued\) \{[\s\S]*?setNotice[\s\S]*?return;/);
assert.match(read('components/InitialCalendarSync.tsx'),/result\.queued \|\| result\.calendarReconnectRequired/);
assert.match(read('lib/crm-context.ts'),/OPEN IN CRM - NO COMPLETION MARKER/);
assert.match(read('app/api/crm/assistant/route.ts'),/Only diagnose a stale completion marker when that exact event has the explicit HIDDEN marker/);
console.log('Queued sync confirmation, bounded read-only polling, two-user/workspace isolation, inactive access, failure copy and Brain status grounding passed');
