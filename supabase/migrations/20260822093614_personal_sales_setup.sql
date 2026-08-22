-- A compact per-workspace working profile for each LiveCoach user.
-- This is intentionally separate from workspace_profile. The company Brain
-- remains the shared product and business truth, while this row controls only
-- how the signed-in person wants LiveCoach to work with them.

create table if not exists public.salesperson_profiles (
  workspace_id uuid not null,
  user_id uuid not null,
  role_title text,
  sales_goal text,
  email_tone text not null default 'warm_direct',
  email_signoff text,
  coaching_style text not null default 'balanced',
  suggestion_frequency text not null default 'standard',
  product_focus text[] not null default '{}'::text[],
  customer_focus text[] not null default '{}'::text[],
  workday_start time,
  workday_end time,
  timezone text not null default 'Europe/London',
  personal_context text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint salesperson_profiles_membership_fkey
    foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id)
    on delete cascade,
  constraint salesperson_profiles_role_title_check
    check (role_title is null or length(trim(role_title)) between 1 and 120),
  constraint salesperson_profiles_sales_goal_check
    check (sales_goal is null or length(trim(sales_goal)) between 1 and 500),
  constraint salesperson_profiles_email_tone_check
    check (email_tone in ('warm_direct', 'consultative', 'concise', 'energetic')),
  constraint salesperson_profiles_email_signoff_check
    check (email_signoff is null or length(trim(email_signoff)) between 1 and 160),
  constraint salesperson_profiles_coaching_style_check
    check (coaching_style in ('direct', 'balanced', 'supportive')),
  constraint salesperson_profiles_suggestion_frequency_check
    check (suggestion_frequency in ('low', 'standard', 'high')),
  constraint salesperson_profiles_product_focus_check
    check (cardinality(product_focus) <= 12),
  constraint salesperson_profiles_customer_focus_check
    check (cardinality(customer_focus) <= 12),
  constraint salesperson_profiles_timezone_check
    check (length(trim(timezone)) between 1 and 80),
  constraint salesperson_profiles_personal_context_check
    check (personal_context is null or length(trim(personal_context)) between 1 and 1000),
  constraint salesperson_profiles_workday_check
    check (
      (workday_start is null and workday_end is null)
      or (workday_start is not null and workday_end is not null and workday_start < workday_end)
    )
);

create index if not exists salesperson_profiles_workspace_completed_idx
  on public.salesperson_profiles (workspace_id, completed_at, updated_at desc);

alter table public.salesperson_profiles enable row level security;

revoke all on public.salesperson_profiles from public, anon, authenticated;
grant select, insert, update on public.salesperson_profiles to authenticated;
grant all on public.salesperson_profiles to service_role;

drop policy if exists "Members read their own sales profile"
  on public.salesperson_profiles;
create policy "Members read their own sales profile"
  on public.salesperson_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = salesperson_profiles.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

drop policy if exists "Members create their own sales profile"
  on public.salesperson_profiles;
create policy "Members create their own sales profile"
  on public.salesperson_profiles for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = salesperson_profiles.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

drop policy if exists "Members update their own sales profile"
  on public.salesperson_profiles;
create policy "Members update their own sales profile"
  on public.salesperson_profiles for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = salesperson_profiles.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = salesperson_profiles.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create or replace function public.audit_salesperson_profile_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  insert into public.access_audit_events (
    workspace_id,
    actor_user_id,
    source,
    action,
    target_table,
    target_id,
    previous_scope,
    next_scope
  ) values (
    new.workspace_id,
    actor_id,
    case when actor_id is null then 'system' else 'human' end,
    case
      when tg_op = 'INSERT' then 'salesperson_profile_completed'
      else 'salesperson_profile_updated'
    end,
    'salesperson_profiles',
    new.user_id::text,
    case
      when tg_op = 'UPDATE' then jsonb_build_object(
        'completed', old.completed_at is not null,
        'updatedAt', old.updated_at
      )
      else '{}'::jsonb
    end,
    jsonb_build_object(
      'completed', new.completed_at is not null,
      'updatedAt', new.updated_at
    )
  );
  return new;
end;
$$;

drop trigger if exists salesperson_profiles_audit
  on public.salesperson_profiles;
create trigger salesperson_profiles_audit
  after insert or update on public.salesperson_profiles
  for each row execute function public.audit_salesperson_profile_change();

revoke execute on function public.audit_salesperson_profile_change()
  from public, anon, authenticated;

comment on table public.salesperson_profiles is
  'One compact working-style profile per user and workspace. It does not grant access to another member''s private CRM, connector, transcript or Brain records.';
comment on column public.salesperson_profiles.personal_context is
  'Short operator guidance supplied by this user. It is bounded and reused directly rather than repeatedly summarised by AI.';
