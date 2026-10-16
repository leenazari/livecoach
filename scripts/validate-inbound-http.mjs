import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
const root=process.cwd();const out=path.resolve(root,'../inbound-qa');mkdirSync(out,{recursive:true});
const children=[];
function start(args,log,env={}) {const p=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});const stream=createWriteStream(path.join(out,log));p.stdout.pipe(stream);p.stderr.pipe(stream);children.push(p);return p;}
const base='http://127.0.0.1:3001', workspace='10000000-0000-4000-8000-000000000001', owner='20000000-0000-4000-8000-000000000001', reviewer='20000000-0000-4000-8000-000000000002',cam='20000000-0000-4000-8000-000000000003',sharon='20000000-0000-4000-8000-000000000004';
function session(userId){const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:userId,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iss:'http://127.0.0.1:54325/auth/v1'})}.fixture-signature`;return { access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:userId,aud:'authenticated',role:'authenticated',email:'fixture@example.com',app_metadata:{},user_metadata:{}}};}
const cookie=id=>`sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session(id))).toString('base64url')}`;
async function request(url,{method='GET',body,user=owner,key}={}){const res=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(key?{Authorization:`Bearer ${key}`}:{Cookie:cookie(user)})},...(body?{body:JSON.stringify(body)}:{})});let data;try{data=await res.json();}catch{data={error:`Non-JSON response ${res.status}`};}return {res,data};}
async function wait(url){for(let i=0;i<90;i++){try{await fetch(url);return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('Local verification server did not start');}
try{
 start(['scripts/inbound-http-fixture.mjs'],'fixture.log');await wait('http://127.0.0.1:54325/health');
 start(['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3001'],'next.log',{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54325',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',NEXT_TELEMETRY_DISABLED:'1'});await wait(base+'/login');
 let result=await request('/api/crm/inbound-leads/access');assert.equal(result.res.status,200,JSON.stringify(result.data));assert.equal(result.data.canReview,true);assert.equal(result.data.enabled,false);
 result=await request('/api/crm/inbound-leads');assert.equal(result.res.status,200,JSON.stringify(result.data));assert.equal(result.data.total,0);
 result=await request('/api/crm/inbound-leads',{user:cam});assert.equal(result.res.status,403);
 // Real Next HTTP handlers and PostgreSQL mutations, with a local-only auth/PostgREST fixture.
 result=await request('/api/crm/inbound-leads/settings',{method:'POST',body:{enabled:true,reviewerId:reviewer,salesIds:[cam,sharon]}});assert.equal(result.res.status,200,JSON.stringify(result.data));
 result=await request('/api/crm/inbound-leads/keys',{method:'POST',body:{label:'Local test only',expiresAt:new Date(Date.now()+86400000).toISOString(),scopes:['leads:create','leads:read','leads:update','events:write'],sources:['facebook'],eventTypes:['call.completed','trial.registered']}});assert.equal(result.res.status,201,JSON.stringify(result.data));const key=result.data.token;
 const lead={source:'facebook',sourceLeadId:'http-fb-1',companyName:'HTTP fixture business',contactName:'Alex Fixture',contactEmail:'alex@example.com',contactPhone:'+447700900123',need:'Screen 60 applicants',consent:{whatsapp:{granted:true,capturedAt:new Date().toISOString(),wording:'Exact test wording',version:'test'}}};
 result=await request('/api/integrations/marketing/leads',{method:'POST',body:lead,key});assert.equal(result.res.status,201,JSON.stringify(result.data));const id=result.data.leadId;
 result=await request('/api/integrations/marketing/leads',{method:'POST',body:lead,key});assert.equal(result.res.status,200);assert.equal(result.data.leadId,id);
 result=await request(`/api/integrations/marketing/leads/${id}`,{method:'PATCH',body:{requestId:'http-call-1',expectedVersion:1,qualification:{monthlyVolume:'60',recommendedProduct:'AI screening',preferredRoute:'demo'}},key});assert.equal(result.res.status,200,JSON.stringify(result.data));
 result=await request(`/api/crm/inbound-leads/${id}`,{method:'PATCH',body:{action:'review',expectedVersion:2,status:'ready'},user:reviewer});assert.equal(result.res.status,200,JSON.stringify(result.data));
 result=await request(`/api/crm/inbound-leads/${id}`,{method:'PATCH',body:{action:'assign',expectedVersion:3,assignedTo:cam,reviewNote:'Confirmed need. Book a demo.'},user:reviewer});assert.equal(result.res.status,200,JSON.stringify(result.data));
 result=await request(`/api/integrations/marketing/leads/${id}`,{key});assert.equal(result.data.contactAllowed.whatsapp,false);
 result=await request(`/api/crm/inbound-leads/${id}`,{user:cam});assert.equal(result.res.status,403);
 console.log('HTTP integration passed: owner session, reviewer session, blocked sales, scoped credential, intake retry, qualification, review and explicit handover through Next handlers into PostgreSQL.');
 const pwPath=process.env.PLAYWRIGHT_MODULE || `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright/index.mjs`;
 const {chromium}=await import(pwPath);const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addCookies([{name:'sb-127-auth-token',value:cookie(owner).split('=')[1],domain:'127.0.0.1',path:'/'}]);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Unrelated CRM assistants/connectors are outside this test story and not contacted.
  await page.route('**/api/**',route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/api/crm/inbound-leads'))return route.continue();if(url.pathname==='/api/auth/team/status')return route.fulfill({json:{role:'owner',department:'sales',callsFirst:false,status:'active'}});return route.fulfill({json:{items:[],notifications:[],messages:[],jobs:[],count:0,unreadCount:0,active:false}});});
  await page.goto(base+'/crm/new-leads',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'New leads',exact:true}).waitFor();await page.getByRole('button',{name:'Try sample view',exact:true}).click();
  await page.getByRole('button',{name:'Northfield Care Group',exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),6);
  await page.screenshot({path:path.join(out,'new-leads-desktop.png'),fullPage:true});
  await page.getByLabel('Status for Westwood Training').selectOption('in_review');assert.equal(await page.getByLabel('Status for Westwood Training').inputValue(),'in_review');
  await page.getByLabel('Filter by source').selectOption('google');assert.equal(await page.locator('tbody tr').count(),2);await page.getByRole('button',{name:'Clear filters'}).click();
  await page.getByRole('button',{name:'Northfield Care Group',exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:path.join(out,'new-leads-detail.png'),fullPage:true});
  await page.getByLabel('Send to').selectOption({label:'Cam'});await page.getByRole('button',{name:'Try sample handover'}).click();await page.getByText(/Handed over to Cam/).waitFor();
  await page.getByRole('button',{name:'Close lead details'}).click();await page.getByRole('button',{name:'Return to live view'}).click();await page.getByRole('button',{name:'HTTP fixture business',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Try sample view',exact:true}).click();await page.screenshot({path:path.join(out,'new-leads-mobile.png'),fullPage:true});
  const width=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(width.scroll<=width.viewport,JSON.stringify(width));
  assert.deepEqual(errors,[],'Browser runtime errors');await context.close();
  console.log('Browser checks passed: desktop, mobile width, sample statuses, source filters, details and sample handover. Screenshots are local QA only.');
 }finally{await browser.close();}
}catch(e){console.error(e.stack||e);process.exitCode=1;}finally{for(const p of children.reverse())p.kill('SIGTERM');await Promise.all(children.map(p=>Promise.race([once(p,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,3000))])));}
