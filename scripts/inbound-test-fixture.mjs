import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Local-only PostgreSQL fixtures. Never imported by application routes.
export async function createInboundFixture() {
const db = new PGlite();
const workspace='10000000-0000-4000-8000-000000000001', outside='10000000-0000-4000-8000-000000000002';
const owner='20000000-0000-4000-8000-000000000001', reviewer='20000000-0000-4000-8000-000000000002', cam='20000000-0000-4000-8000-000000000003', sharon='20000000-0000-4000-8000-000000000004', other='20000000-0000-4000-8000-000000000005';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key);
create table public.workspaces(id uuid primary key,name text not null default 'Fixture workspace');
create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text,department text,primary key(workspace_id,user_id));
create table public.marketing_campaigns(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,name text,audience text,offer text,channel text,status text,unique(id,workspace_id));
create table public.marketing_leads(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,campaign_id uuid,company_name text,contact_name text,contact_email text,company_size text,notes text,assigned_to_user_id uuid,unique(id,workspace_id));
grant usage on schema public,auth to authenticated,service_role;
grant select on public.workspace_members to authenticated;
grant all on public.workspaces,public.workspace_members,public.marketing_campaigns,public.marketing_leads to service_role;
grant select,insert,update on public.marketing_leads to authenticated;
alter table public.marketing_leads enable row level security;
create policy existing_marketing_read on public.marketing_leads for select to authenticated using(owner_id=(select auth.uid()) or assigned_to_user_id=(select auth.uid()) or exists(select 1 from public.workspace_members m where m.workspace_id=marketing_leads.workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','manager') and m.status='active'));
create policy existing_marketing_insert on public.marketing_leads for insert to authenticated with check(owner_id=(select auth.uid()));
create policy existing_marketing_update on public.marketing_leads for update to authenticated using(true) with check(true);
`);
for(const id of [owner,reviewer,cam,sharon,other]) await db.query('insert into auth.users values($1)',[id]);
for(const id of [workspace,outside]) await db.query('insert into public.workspaces(id) values($1)',[id]);
for(const [w,u,r,d] of [[workspace,owner,'owner','sales'],[workspace,reviewer,'sales','marketing'],[workspace,cam,'sales','sales'],[workspace,sharon,'sales','sales'],[workspace,other,'manager','marketing'],[outside,other,'owner','sales'],[outside,reviewer,'sales','marketing']]) await db.query("insert into public.workspace_members values($1,$2,$3,'active',$4)",[w,u,r,d]);
await db.exec(readFileSync(new URL('../supabase/migrations/20261015191202_inbound_new_leads_api.sql',import.meta.url),'utf8'));

await db.exec(`create table public.profiles(user_id uuid primary key,display_name text); grant select on public.profiles to authenticated,service_role;`);
for (const [id,name] of [[owner,'Owner'],[reviewer,'Nikhara'],[cam,'Cam'],[sharon,'Sharon'],[other,'Other manager']]) await db.query('insert into public.profiles values($1,$2)',[id,name]);
return {db,workspace,outside,owner,reviewer,cam,sharon,other};
}
