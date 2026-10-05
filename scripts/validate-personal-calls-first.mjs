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
let mobile=true, preference=true;
window.matchMedia=()=>({matches:mobile,addEventListener(){},removeEventListener(){}});
const Nav=load('components/crm/NavMenu.tsx',name=>{
  if(name==='next/link') return {default:({children,...props})=>React.createElement('a',props,children)};
  if(name==='next/navigation') return {usePathname:()=>'/crm',useRouter:()=>({}),useSearchParams:()=>new URLSearchParams()};
  if(name==='@/lib/crm') return {getCached:()=>null,crmFetch:async()=>({role:'owner',callsFirst:preference}),clearCrmCache(){}};
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
const page=read('app/crm/page.tsx');
assert.ok(page.indexOf('{dash?.callsFirst && <UpcomingCalls') < page.indexOf('◆ Revenue command centre'));
assert.match(page,/!dash\?\.callsFirst && <UpcomingCalls/);
assert.match(read('app/api/crm/dashboard/route.ts'),/callsFirst \|\| !u.prepped/);
console.log('Private preference, two-user isolation, default ordering, prepared calls and real mobile navigation passed');
