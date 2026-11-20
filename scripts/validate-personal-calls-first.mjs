import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { compareDashboardActions } from '../lib/dashboard-priority.ts';
const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function load(file, deps) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require','module','exports',code)(deps,module,module.exports);
  return module.exports;
}
const rows = [
  { workspace_id:'a',owner_id:'lee',visibility:'private',key:'dashboard_calls_first',value:'true' },
  { workspace_id:'a',owner_id:'manager',visibility:'team',key:'dashboard_calls_first',value:'true' },
];
let fail = false;
const db = { from() { const filters=[]; return {
  select() {return this;}, eq(k,v) {filters.push([k,v]); return this;},
  async maybeSingle() {return {data:rows.find(r=>filters.every(([k,v])=>r[k]===v)) || null,error:fail ? new Error('unavailable') : null};},
};}};
const {personalCallsFirst} = load('lib/personal-dashboard.ts',name => name==='server-only'?{}:{supabaseService:db});
assert.equal(await personalCallsFirst({userId:'lee',workspaceId:'a'}),true);
assert.equal(await personalCallsFirst({userId:'kam',workspaceId:'a'}),false,'Same-workspace colleague must retain defaults');
assert.equal(await personalCallsFirst({userId:'lee',workspaceId:'b'}),false,'No cross-workspace preference');
fail=true;
assert.equal(await personalCallsFirst({userId:'lee',workspaceId:'a'}),false,'Read failure uses default layout');
const items=[{id:'deal',entity:'opportunity',score:500},{id:'later',entity:'upcoming',score:130,at:'2026-10-06T12:00:00Z'},{id:'soon',entity:'upcoming',score:130,at:'2026-10-06T09:00:00Z'}];
assert.deepEqual([...items].sort((a,b)=>compareDashboardActions(a,b,true)).map(x=>x.id),['soon','later','deal']);
assert.deepEqual([...items].sort((a,b)=>compareDashboardActions(a,b,false)).map(x=>x.id),['deal','later','soon']);
const dom=new JSDOM('<div id="root"></div>',{url:'https://crm.test/crm'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
let mobile=true, preference=true, viewerRole='owner', department='sales', statusUnavailable=false, pathname='/crm';
window.matchMedia=()=>({matches:mobile,addEventListener(){},removeEventListener(){}});
const Nav=load('components/crm/NavMenu.tsx',name=>{
  if(name==='next/link') return {default:({children,...props})=>React.createElement('a',props,children)};
  if(name==='next/navigation') return {usePathname:()=>pathname,useRouter:()=>({}),useSearchParams:()=>new URLSearchParams()};
  if(name==='@/lib/crm') return {getCached:()=>null,crmFetch:async(url)=>{
    if(url==='/api/crm/inbound-leads/access') return {canReview:false};
    if(statusUnavailable) throw new Error('Status unavailable');
    return {role:viewerRole,department,callsFirst:preference};
  },clearCrmCache(){}};
  if(name==='@/lib/supabase-browser') return {};
  if(name.startsWith('@/components/')) return {default:()=>null};
  return require(name);
}).default;
for(const personal of [true,false]) {
  preference=personal;
  const root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(Nav));});
  const hrefs=[...document.querySelectorAll('nav[aria-label="Main navigation"] a')].map(a=>a.getAttribute('href'));
  assert.deepEqual(hrefs,personal?['/crm','/crm/calls','/call','/crm/tasks']:['/crm/outreach','/crm','/call','/crm/tasks']);
  await act(async()=>root.unmount());
}
// Calls must be a direct destination for staff without enabling the owner's
// private calls-first dashboard preference or hiding Outreach and Tasks.
for(const role of ['sales','manager']) {
  for(const team of ['sales','marketing']) {
    for(const phone of [false,true]) {
      viewerRole=role;
      department=team;
      mobile=phone;
      preference=false;
      pathname='/crm/calls';
      const root=createRoot(document.getElementById('root'));
      await act(async()=>{root.render(React.createElement(Nav));});
      const home=team==='marketing'?'/crm/marketing':'/crm/inbox';
      const hrefs=[...document.querySelectorAll(phone?'nav[aria-label="Main navigation"] a':'aside nav a')].map(a=>a.getAttribute('href'));
      assert.equal(hrefs.filter(href=>href==='/crm/calls').length,1,`${role}/${team} must have one visible Calls destination on ${phone?'mobile':'desktop'}`);
      assert.equal(document.querySelectorAll('a[href="/crm/calls"][aria-current="page"]').length,1,'Calls is highlighted on its own page');
      assert.ok(hrefs.includes(home),'Keep the member-specific home');
      assert.ok(hrefs.includes('/crm/tasks'),'Tasks remain directly accessible');
      if(phone) assert.ok(hrefs.includes('/crm/outreach?tab=prospects'),'Outreach remains directly accessible on mobile');
      else {
        assert.equal(hrefs[hrefs.indexOf(home)+1],'/crm/calls','Place Calls immediately after Today');
        const more=[...document.querySelectorAll('button')].find(button=>button.textContent.includes('More tools'));
        await act(async()=>more.click());
        assert.equal(document.querySelectorAll('a[href="/crm/calls"]').length,1,'Do not duplicate Calls under More tools');
      }
      await act(async()=>root.unmount());
    }
  }
}
// A delayed or failed role lookup must not make the Calls destination vanish.
statusUnavailable=true;
mobile=false;
const fallbackRoot=createRoot(document.getElementById('root'));
await act(async()=>{fallbackRoot.render(React.createElement(Nav));});
assert.equal(document.querySelectorAll('aside nav a[href="/crm/calls"]').length,1);
await act(async()=>fallbackRoot.unmount());
const page=read('app/crm/page.tsx');
assert.ok(page.indexOf('{dash?.callsFirst && <UpcomingCalls') < page.indexOf('◆ Revenue command centre'));
assert.match(page,/!dash\?\.callsFirst && <UpcomingCalls/);
assert.match(read('app/api/crm/dashboard/route.ts'),/callsFirst \|\| !u.prepped/);
console.log('Private preference, two-user isolation, default ordering, prepared calls, staff Calls navigation and fallback checks passed');
