-- Campaign availability belongs to the workspace. The campaign a salesperson
-- is actively working belongs to that user. Keeping those two concepts
-- separate prevents one salesperson from silently switching another person's
-- daily queue.
create table if not exists public.outreach_user_campaign_preferences (
  workspace_id uuid not null,
  user_id uuid not null,
  active_campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint outreach_user_campaign_preferences_membership_fkey
    foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id)
    on delete cascade
);

create index if not exists outreach_user_campaign_preferences_campaign_idx
  on public.outreach_user_campaign_preferences (workspace_id, active_campaign_id);

create or replace function public.validate_outreach_user_campaign_preference()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.user_id
      and wm.status = 'active'
  ) then
    raise exception 'the outreach user is not an active workspace member';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.updated_by
      and wm.status = 'active'
  ) then
    raise exception 'the campaign selection actor is not an active workspace member';
  end if;

  if new.active_campaign_id is not null and not exists (
    select 1
    from public.outreach_campaigns c
    where c.id = new.active_campaign_id
      and c.workspace_id = new.workspace_id
      and c.status = 'active'
  ) then
    raise exception 'the selected outreach campaign is not active in this workspace';
  end if;

  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists validate_outreach_user_campaign_preference_trigger
  on public.outreach_user_campaign_preferences;
create trigger validate_outreach_user_campaign_preference_trigger
  before insert or update of workspace_id, user_id, active_campaign_id, updated_by
  on public.outreach_user_campaign_preferences
  for each row execute function public.validate_outreach_user_campaign_preference();

alter table public.outreach_user_campaign_preferences enable row level security;

revoke all on table public.outreach_user_campaign_preferences
  from public, anon, authenticated;
grant select, insert, update on table public.outreach_user_campaign_preferences
  to authenticated;
grant all on table public.outreach_user_campaign_preferences to service_role;

create policy "Users read only their outreach campaign selection"
  on public.outreach_user_campaign_preferences for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_user_campaign_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Users create only their outreach campaign selection"
  on public.outreach_user_campaign_preferences for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and updated_by = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_user_campaign_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Users update only their outreach campaign selection"
  on public.outreach_user_campaign_preferences for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_user_campaign_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and updated_by = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_user_campaign_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

revoke execute on function public.validate_outreach_user_campaign_preference()
  from public, anon, authenticated;

comment on table public.outreach_user_campaign_preferences is
  'One user-scoped active outreach campaign per workspace. It changes only that user''s queue and never another salesperson''s campaign.';
