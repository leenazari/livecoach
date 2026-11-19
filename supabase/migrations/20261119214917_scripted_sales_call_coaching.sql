-- Additive storage. Existing call capture and coaching remain intact.
create table public.call_script_plans (
  workspace_id uuid not null references public.workspaces(id),
  owner_id uuid not null references auth.users(id),
  context_key text not null check (length(context_key) between 1 and 160),
  session_id text,
  company_id uuid references public.companies(id) on delete set null,
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products)='array'),
  stage text not null default 'hook',
  prep jsonb not null default '{}'::jsonb,
  script_snapshot jsonb not null default '{}'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,owner_id,context_key)
);
create index call_script_plans_session on public.call_script_plans(workspace_id,owner_id,session_id) where session_id is not null;
alter table public.call_script_plans enable row level security;
revoke all on public.call_script_plans from anon,authenticated;
grant select,insert,update on public.call_script_plans to authenticated;
grant all on public.call_script_plans to service_role;
create policy "Own active call script plans" on public.call_script_plans for all to authenticated
using (owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=call_script_plans.workspace_id and m.user_id=(select auth.uid()) and m.status='active'))
with check (owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=call_script_plans.workspace_id and m.user_id=(select auth.uid()) and m.status='active'));

-- Only the guarded application route accesses client interests, after checking
-- current ownership, assignment or enabled team cover. No public table access.
create table public.client_product_interests (
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id) on delete cascade,
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products)='array'),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,company_id)
);
alter table public.client_product_interests enable row level security;
revoke all on public.client_product_interests from anon,authenticated;
grant all on public.client_product_interests to service_role;

create table public.script_call_coaching (
  workspace_id uuid not null references public.workspaces(id),
  owner_id uuid not null references auth.users(id),
  session_id text not null,
  call_id uuid not null references public.interview_summaries(id) on delete cascade,
  state text not null default 'generating' check(state in ('generating','ready','error')),
  report jsonb,
  owner_note text,
  reviewed_by uuid references auth.users(id),
  lease_until timestamptz not null default now()+interval '2 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,owner_id,session_id)
);
create index script_call_coaching_recent on public.script_call_coaching(workspace_id,owner_id,created_at desc);
alter table public.script_call_coaching enable row level security;
revoke all on public.script_call_coaching from anon,authenticated;
grant select on public.script_call_coaching to authenticated;
grant all on public.script_call_coaching to service_role;
create policy "Personal coaching or workspace owner review" on public.script_call_coaching for select to authenticated
using (exists(select 1 from public.workspace_members m where m.workspace_id=script_call_coaching.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (script_call_coaching.owner_id=m.user_id or m.role='owner')));
