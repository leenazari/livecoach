-- Per-user progress for the optional sales outreach walkthrough. This stores
-- only tutorial state. It never copies CRM, connector, call or transcript data.

create table if not exists public.sales_tutorial_progress (
  workspace_id uuid not null,
  user_id uuid not null,
  guide_key text not null,
  status text not null default 'active',
  current_step smallint not null default 0,
  last_path text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, guide_key),
  constraint sales_tutorial_progress_membership_fkey
    foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id)
    on delete cascade,
  constraint sales_tutorial_progress_guide_key_check
    check (guide_key ~ '^[a-z0-9_]{3,80}$'),
  constraint sales_tutorial_progress_status_check
    check (status in ('active', 'paused', 'completed', 'dismissed')),
  constraint sales_tutorial_progress_current_step_check
    check (current_step between 0 and 7),
  constraint sales_tutorial_progress_last_path_check
    check (last_path is null or (last_path like '/crm%' and length(last_path) <= 300)),
  constraint sales_tutorial_progress_completion_check
    check (
      (status = 'completed' and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    ),
  constraint sales_tutorial_progress_dismissal_check
    check (
      (status = 'dismissed' and dismissed_at is not null)
      or (status <> 'dismissed' and dismissed_at is null)
    )
);

alter table public.sales_tutorial_progress enable row level security;

revoke all on public.sales_tutorial_progress from public, anon, authenticated;
grant select, insert, update on public.sales_tutorial_progress to authenticated;
grant all on public.sales_tutorial_progress to service_role;

drop policy if exists "Members read their own tutorial progress"
  on public.sales_tutorial_progress;
create policy "Members read their own tutorial progress"
  on public.sales_tutorial_progress for select to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = sales_tutorial_progress.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

drop policy if exists "Members create their own tutorial progress"
  on public.sales_tutorial_progress;
create policy "Members create their own tutorial progress"
  on public.sales_tutorial_progress for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = sales_tutorial_progress.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

drop policy if exists "Members update their own tutorial progress"
  on public.sales_tutorial_progress;
create policy "Members update their own tutorial progress"
  on public.sales_tutorial_progress for update to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = sales_tutorial_progress.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = sales_tutorial_progress.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

comment on table public.sales_tutorial_progress is
  'Per-user progress for optional LiveCoach product walkthroughs. No CRM content is stored here.';
comment on column public.sales_tutorial_progress.status is
  'Active reopens automatically, paused stays closed, completed and dismissed can be restarted manually.';
