import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
function compile(file, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require','module','exports',code)(name => name in deps ? deps[name] : name === 'server-only' || name.startsWith('@/') ? {} : require(name), module,module.exports);
  return module.exports;
}
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table workspaces(id uuid primary key,team_lead_cover_enabled boolean default false);
create table workspace_members(workspace_id uuid,user_id uuid,status text,role text,primary key(workspace_id,user_id));
create table companies(id uuid primary key,workspace_id uuid,owner_id uuid,name text,stage text,sector text,profile jsonb default '{}',is_confidential boolean default false);
create table team_client_shares(workspace_id uuid,company_id uuid,assigned_to_user_id uuid,status text);
create table workstreams(id uuid primary key,workspace_id uuid,owner_id uuid,company_id uuid);
create table crm_notifications(id uuid primary key,workspace_id uuid,user_id uuid,kind text,title text,body text,source_table text,source_id text,source_event_key text,read_at timestamptz,dismissed_at timestamptz,snoozed_until timestamptz);
create table tasks(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,company_id uuid,workstream_id uuid,text text,kind text,link_kind text,status text default 'open',source text,source_ref text,fingerprint text,payload jsonb default '{}',due_at timestamptz,done_at timestamptz,visibility text,unique(owner_id,fingerprint));
create table outreach_prospects(id uuid primary key,workspace_id uuid,owner_id uuid,assigned_to_user_id uuid,crm_company_id uuid,source_metadata jsonb default '{}',status text default 'replied',last_contacted_at timestamptz,next_action_at timestamptz,updated_at timestamptz);
create table outreach_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,prospect_id uuid,kind text constraint outreach_events_kind_check check(kind in ('manual_call')),metadata jsonb,visibility text);
create table opportunities(id uuid primary key,workspace_id uuid,owner_id uuid,assigned_to_user_id uuid,company_id uuid,workstream_id uuid,visibility text default 'private',status text default 'open',opportunity_type text default 'revenue',next_action text,next_action_due_at timestamptz,next_action_owner text not null default 'us',next_action_override boolean default false,next_action_override_at timestamptz,last_meaningful_activity_at timestamptz,last_change_context jsonb,deal_intent text default 'Manual intent',pipeline_stage text default 'discovery');
create table upcoming_calls(id uuid primary key,workspace_id uuid,owner_id uuid,company_id uuid,workstream_id uuid,scheduled_at timestamptz,completed_at timestamptz,prep jsonb,intent text);
create table client_context(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,company_id uuid,workstream_id uuid,kind text,title text,content text,visibility text,source_ref text,metadata jsonb,created_at timestamptz default now(),unique(owner_id,source_ref));
create table opportunity_events(id serial primary key,opportunity_id uuid,context jsonb);
create function fixture_opportunity_history() returns trigger language plpgsql as $$ begin insert into public.opportunity_events(opportunity_id,context) values(new.id,new.last_change_context); return new; end $$;
create trigger history after update on opportunities for each row execute function fixture_opportunity_history();
grant usage on schema public,auth to authenticated,service_role;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
grant select on client_context to authenticated;
alter table client_context enable row level security;
create policy owner_notes on client_context for select to authenticated using(owner_id=auth.uid() and visibility='private');
`);
await db.exec(read('supabase/migrations/20261026111715_notification_action_log.sql'));
const alice = randomUUID(), bob = randomUUID(), tenant = randomUUID(), outside = randomUUID();
await db.query('insert into workspaces values($1,false),($2,false)',[tenant,outside]);
await db.query("insert into workspace_members values($1,$2,'active','sales'),($1,$3,'active','sales'),($4,$3,'active','sales')",[tenant,alice,bob,outside]);
async function insert(table, row) {
  const keys = Object.keys(row);
  await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
}
async function fixture({ owner = alice, companyOwner = owner, workspace = tenant, prospect = false, opportunity = true, workstream = null } = {}) {
  const ids = { company: randomUUID(), task: randomUUID(), notification: randomUUID(), opportunity: randomUUID(), call: randomUUID(), prospect: prospect ? randomUUID() : null };
  await insert('companies',{id:ids.company,workspace_id:workspace,owner_id:companyOwner,name:'Test client'});
  if (workstream) await insert('workstreams',{id:workstream,company_id:ids.company,workspace_id:workspace,owner_id:owner});
  if (prospect) await insert('outreach_prospects',{id:ids.prospect,workspace_id:workspace,owner_id:companyOwner,assigned_to_user_id:owner,crm_company_id:ids.company});
  await insert('tasks',{id:ids.task,workspace_id:workspace,owner_id:owner,company_id:ids.company,workstream_id:workstream,text:'Reply to the lead',source:prospect?'outreach_reply':'important_email_monitor',source_ref:prospect?'reply-source':`google:${ids.notification}`,payload:prospect?{outreachProspectId:ids.prospect,receivedAt:'2026-10-26T09:00:00Z'}:{},visibility:'private'});
  await insert('crm_notifications',{id:ids.notification,workspace_id:workspace,user_id:owner,kind:prospect?'outreach_reply':'important_email',title:'Reply from lead',source_table:prospect?'outreach_prospects':'companies',source_id:ids.prospect || ids.company,source_event_key:prospect?`outreach_reply:${ids.prospect}:2026-10-26T09:00:00+00:00`:`important_email:google:${ids.notification}`});
  if (opportunity) await insert('opportunities',{id:ids.opportunity,workspace_id:workspace,owner_id:owner,company_id:ids.company,workstream_id:workstream,next_action:'Reply to the lead'});
  await insert('upcoming_calls',{id:ids.call,workspace_id:workspace,owner_id:owner,company_id:ids.company,workstream_id:workstream,scheduled_at:'2099-11-01T10:00:00Z',intent:'Keep my manual intent',prep:{suggestedComps:['Existing focus'],intentMeta:{source:'manual'}}});
  return ids;
}
const defaults = { actor:alice,workspace:tenant,request:randomUUID(),mode:'log',note:'Called Ben. He requested a product demonstration.',channel:'phone',complete:true,next:'Arrange the demo',due:'2099-11-02T10:00:00Z' };
async function record(ids, overrides = {}) {
  const p={...defaults,request:randomUUID(),...overrides};
  return (await db.query('select public.record_notification_action_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as receipt',[p.actor,p.workspace,ids.notification,p.request,p.mode,p.note,p.channel,p.complete,p.next,p.due])).rows[0].receipt;
}
const row = async (table,id) => (await db.query(`select * from ${table} where id=$1`,[id])).rows[0];
const count = async table => Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
await db.exec('set role service_role');
const first=await fixture();
const requestId=randomUUID(), receipt=await record(first,{request:requestId});
assert.equal(receipt.ok,true); assert.equal(receipt.companyId,first.company); assert.equal(receipt.callId,first.call);
assert.equal((await row('tasks',first.task)).status,'done'); assert.ok((await row('tasks',first.task)).done_at);
assert.ok((await row('crm_notifications',first.notification)).dismissed_at);
const note=await row('client_context',receipt.contextId); assert.equal(note.owner_id,alice); assert.equal(note.visibility,'private'); assert.match(note.content,/Called Ben/);
assert.equal((await row('tasks',receipt.nextTaskId)).owner_id,alice);
const deal=await row('opportunities',first.opportunity); assert.equal(deal.next_action,'Arrange the demo'); assert.equal(deal.next_action_override,true); assert.equal(deal.deal_intent,'Manual intent'); assert.equal(deal.pipeline_stage,'discovery');
assert.equal((await row('upcoming_calls',first.call)).intent,'Keep my manual intent');
assert.deepEqual((await row('upcoming_calls',first.call)).prep,{suggestedComps:['Existing focus'],intentMeta:{source:'manual'}});
const beforeRetry=await count('client_context');
assert.equal((await record(first,{request:requestId})).alreadySaved,true); assert.equal(await count('client_context'),beforeRetry);
await assert.rejects(()=>record(first,{request:requestId,note:'Changed after a lost response'}),e=>e.code==='23505');
await assert.rejects(()=>record(first),e=>e.code==='23505','A second tab must not complete twice');
assert.equal((await db.query('select count(*)::int as n from opportunity_events where opportunity_id=$1',[first.opportunity])).rows[0].n,1);

const done=await fixture();
const doneReceipt=await record(done,{mode:'done',note:'',channel:'note',next:'',due:null});
assert.match((await row('client_context',doneReceipt.contextId)).content,/No email send or meeting attendance was verified/);
assert.equal((await row('opportunities',done.opportunity)).next_action,null,'Clear only an exactly matching completed next action');
assert.equal(doneReceipt.nextTaskId,null); assert.equal(doneReceipt.callId,null);
const progress=await fixture();
await record(progress,{complete:false,next:'',due:null});
assert.equal((await row('tasks',progress.task)).status,'open');
assert.equal((await row('crm_notifications',progress.notification)).dismissed_at,null);
assert.equal((await row('crm_notifications',progress.notification)).read_at,null,'Keep a progress update visible in Unread');
const oldReply=await fixture({prospect:true});
const newerTask=randomUUID();
await insert('tasks',{id:newerTask,workspace_id:tenant,owner_id:alice,company_id:oldReply.company,text:'New reply',status:'open',source:'sendpilot_reply',payload:{outreachProspectId:oldReply.prospect,receivedAt:'2026-10-26T10:00:00Z'}});
await record(oldReply);
assert.equal((await row('tasks',newerTask)).status,'open','Do not close a later reply from the same person');
assert.equal((await row('outreach_prospects',oldReply.prospect)).status,'replied','Logging never advances a sequence or fabricates sends');
assert.equal((await row('outreach_prospects',oldReply.prospect)).last_contacted_at,null);
assert.doesNotMatch(JSON.stringify((await db.query('select metadata from outreach_events')).rows),/Called Ben/,'Shared outreach events store references only');
const multiple=await fixture();
await insert('opportunities',{id:randomUUID(),workspace_id:tenant,owner_id:alice,company_id:multiple.company});
assert.equal((await record(multiple)).pipelineNeedsSelection,true);
assert.equal((await row('opportunities',multiple.opportunity)).next_action,'Reply to the lead');
const otherWorkstream=await fixture();
await db.query('update opportunities set workstream_id=$1 where id=$2',[randomUUID(),otherWorkstream.opportunity]);
assert.equal((await record(otherWorkstream)).opportunityId,null,'Do not apply company-wide activity to a different project');

// Full access matrix. An owned notification alone is not an authority grant.
const untouched=await fixture();
for (const params of [{actor:bob},{workspace:outside}]) await assert.rejects(()=>record(untouched,params),e=>['P0002','42501'].includes(e.code));
await db.query("update workspace_members set status='removed' where workspace_id=$1 and user_id=$2",[tenant,alice]);
await assert.rejects(()=>record(untouched),e=>e.code==='42501');
await db.query("update workspace_members set status='active' where workspace_id=$1 and user_id=$2",[tenant,alice]);
const shared=await fixture({companyOwner:bob});
await assert.rejects(()=>record(shared),e=>e.code==='42501');
await insert('team_client_shares',{workspace_id:tenant,company_id:shared.company,assigned_to_user_id:alice,status:'active'});
assert.equal((await record(shared)).ok,true,'Explicit safe sales assignment works');
await db.query('update workspaces set team_lead_cover_enabled=true where id=$1',[tenant]);
assert.equal((await record(await fixture({companyOwner:bob}))).ok,true,'Owner-enabled ordinary sales cover works');
for (const classification of ['investor','internal','personal','large partner','partner strategic','staff','private']) {
  const protectedClient=await fixture({companyOwner:bob});
  await db.query('update companies set profile=$1 where id=$2',[{triage:{classification}},protectedClient.company]);
  await assert.rejects(()=>record(protectedClient),e=>e.code==='42501',classification);
}
const confidential=await fixture({companyOwner:bob});
await db.query('update companies set is_confidential=true where id=$1',[confidential.company]);
await assert.rejects(()=>record(confidential),e=>e.code==='42501');
const reassigned=await fixture({prospect:true});
await db.query('update outreach_prospects set assigned_to_user_id=$1 where id=$2',[bob,reassigned.prospect]);
await assert.rejects(()=>record(reassigned),e=>e.code==='42501');
const mismatch=await fixture();
await db.query('update tasks set company_id=$1 where id=$2',[first.company,mismatch.task]);
await assert.rejects(()=>record(mismatch),e=>e.code==='23505');
assert.equal((await row('tasks',untouched.task)).status,'open');

// The real PL/pgSQL function must roll back an earlier note/task if a later write fails.
await db.exec('reset role');
await db.exec(`create function fail_next_task() returns trigger language plpgsql as $$ begin if new.text='FORCE_FAILURE' then raise exception 'fixture write failure'; end if; return new; end $$;
create trigger fail_next before insert on tasks for each row execute function fail_next_task();`);
await db.exec('set role service_role');
const rollback=await fixture(), beforeRollback=await count('client_context');
await assert.rejects(()=>record(rollback,{next:'FORCE_FAILURE'}),/fixture write failure/);
assert.equal(await count('client_context'),beforeRollback);
assert.equal((await row('tasks',rollback.task)).status,'open');
assert.equal((await row('crm_notifications',rollback.notification)).dismissed_at,null);
await db.exec('reset role; set role authenticated');
await assert.rejects(()=>record(untouched),e=>e.code==='42501','Clients cannot forge a service RPC actor');
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[bob]);
assert.equal((await db.query('select * from client_context where id=$1',[receipt.contextId])).rows.length,0);
await db.exec('reset role; set role service_role');

// Exercise HTTP validation and auth-to-RPC binding against the same PostgreSQL.
const helpers=compile('lib/notification-actions.ts');
let scope={userId:alice,workspaceId:tenant,status:'active',role:'sales'}, rpcCalls=0;
const route=compile('app/api/crm/notifications/[id]/action/route.ts',{
  '@/lib/request-scope':{requireRequestScope:()=>scope}, '@/lib/notification-actions':helpers,
  '@/lib/uuid':compile('lib/uuid.ts'), '@/lib/crm-blocker':{crmBlockerPayload:x=>({error:x.reason})},
  '@/lib/supabase':{supabaseService:{rpc:async(name,p)=>{
    rpcCalls++; assert.equal(name,'record_notification_action_service');
    try { return {data:await record({notification:p.p_notification},{actor:p.p_actor,workspace:p.p_workspace,request:p.p_request,mode:p.p_mode,note:p.p_note,channel:p.p_channel,complete:p.p_complete,next:p.p_next_action,due:p.p_due_at}),error:null}; }
    catch(e) { return {data:null,error:{code:e.code,message:e.message}}; }
  }}},
});
async function post(ids,input) {
  return route.POST(new NextRequest('https://livecoach.test/api/crm/notifications/test/action',{method:'POST',body:JSON.stringify(input)}),{params:{id:ids.notification}});
}
const http=await fixture();
for(const input of [{mode:'log'}, {requestId:randomUUID(),mode:'log',note:''}, {requestId:randomUUID(),mode:'done',ownerId:bob}, {requestId:randomUUID(),mode:'done',companyId:first.company}, {requestId:randomUUID(),mode:'log',note:'Okay',channel:'forged'}, {requestId:randomUUID(),mode:'log',note:'Okay',dueAt:'not a date'}, {requestId:randomUUID(),mode:'log',note:'x'.repeat(4001)}]) assert.equal((await post(http,input)).status,400);
assert.equal(rpcCalls,0);
const goodInput={requestId:randomUUID(),mode:'log',note:'Recorded via the UI',complete:false};
const response=await post(http,goodInput); assert.equal(response.status,200); assert.equal(response.headers.get('Cache-Control'),'private, no-store');
scope={...scope,userId:bob}; assert.equal((await post(http,goodInput)).status,404);
scope={...scope,userId:alice,status:'onboarding'}; assert.equal((await post(http,goodInput)).status,403);
scope={...scope,status:'active'};

// Composer must keep interim speech visible and save only on the explicit button.
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://livecoach.test'});
globalThis.window=dom.window; globalThis.document=dom.window.document;
globalThis.HTMLElement=dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let speech, requests=[], saved=null, shouldFail=false;
class Speech { start(){speech=this;} stop(){this.onend?.();} abort(){this.onend?.();} }
window.SpeechRecognition=Speech;
const Composer=compile('components/crm/NotificationActionComposer.tsx',{
  '@/lib/dictation':compile('lib/dictation.ts'),
  '@/lib/crm':{crmFetch:async(url,opts)=>{
    requests.push({url,body:JSON.parse(opts.body)});
    if(shouldFail) throw new Error('Save unavailable');
    return {ok:true,contextId:randomUUID(),completed:false};
  }},
}).default;
const root=createRoot(document.getElementById('root'));
await act(async()=>root.render(React.createElement(Composer,{notificationId:http.notification,title:'Ben',onSaved:r=>{saved=r;},onClose:()=>{}})));
const click=async label=>act(async()=>Simulate.click([...document.querySelectorAll('button')].find(x=>x.textContent===label)));
assert.equal(requests.length,0);
await click('Speak actions');
function say(text,final=false) { const result=[{transcript:text}]; result.isFinal=final; speech.onresult({results:[result]}); }
await act(async()=>say('I called Ben and agreed a demo'));
assert.equal(document.querySelector('textarea').value,'I called Ben and agreed a demo');
await act(async()=>say('I called'));
assert.equal(document.querySelector('textarea').value,'I called Ben and agreed a demo','Do not erase words during mobile recognition revisions');
await click('Stop speaking'); assert.equal(requests.length,0);
shouldFail=true;
await act(async()=>Simulate.submit(document.querySelector('form')));
assert.match(document.querySelector('[role="alert"]').textContent,/Save unavailable/);
assert.match(document.querySelector('textarea').value,/I called Ben/);
shouldFail=false;
await act(async()=>Simulate.submit(document.querySelector('form')));
assert.equal(requests[0].body.requestId,requests[1].body.requestId,'A lost response retries the same operation');
assert.equal(saved.ok,true); assert.equal(requests[1].body.note,'I called Ben and agreed a demo');
await click('Speak actions'); const lastSpeech=speech;
await act(async()=>root.unmount()); lastSpeech.onend();
assert.equal(requests.length,2,'Unmount must not save or generate anything');
const activity=compile('lib/outreach-last-activity.ts');
assert.equal(activity.outreachLastActivityAt({last_reply_at:'2026-01-01',source_metadata:{latest_notification_action:{at:'2026-10-26'}}}),'2026-10-26');
assert.equal(activity.outreachLastActivityAt({last_reply_at:'invalid'}),null);
assert.doesNotMatch(read('app/api/crm/notifications/[id]/action/route.ts'),/openai|sendConnectedMail|generateTaskEmailDraft/);
assert.match(read('app/call/page.tsx'),/ok && !degraded[\s\S]*setActivityContextSeen\(contextUsed\)/);
assert.match(read('lib/notification-action-context.ts'),/eq\("owner_id", scope.userId\)/);
assert.match(read('app/api/interview/context/route.ts'),/actionQuery[\s\S]*eq\("owner_id", account.userId\)/);
assert.match(read('app/api/crm/upcoming/[id]/route.ts'),/clientActivityContextSeen: ownPrep.clientActivityContextSeen/);
await db.close();
console.log('PASS notification actions. Atomic PostgreSQL writes and rollback, exact task/reply identity, private two-user isolation, safe sales cover, protected clients, replay safety, HTTP validation, typed/visible speech, no automatic drafts, and activity sorting.');
