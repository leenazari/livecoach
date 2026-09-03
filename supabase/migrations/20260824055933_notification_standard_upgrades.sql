-- Standard notification controls stay user-scoped and model-free. Snoozing
-- changes only delivery state. The canonical reply or assignment remains in
-- its existing source table.
alter table public.crm_notifications
  add column if not exists snoozed_until timestamptz,
  add column if not exists attention_at timestamptz generated always as (
    coalesce(snoozed_until, created_at)
  ) stored;

alter table public.crm_notifications
  drop constraint if exists crm_notifications_snoozed_until_check,
  add constraint crm_notifications_snoozed_until_check check (
    snoozed_until is null or snoozed_until > created_at
  );

create index if not exists crm_notifications_user_snoozed_idx
  on public.crm_notifications (user_id, workspace_id, snoozed_until)
  where dismissed_at is null and read_at is null and snoozed_until is not null;

create index if not exists crm_notifications_user_attention_idx
  on public.crm_notifications (user_id, workspace_id, attention_at desc)
  where dismissed_at is null and read_at is null;

create table public.crm_notification_preferences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reply_alerts boolean not null default true,
  assignment_alerts boolean not null default true,
  in_app_enabled boolean not null default true,
  desktop_enabled boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_start time not null default '18:00',
  quiet_end time not null default '08:00',
  timezone text not null default 'Europe/London' check (
    length(timezone) between 1 and 64
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  check (quiet_start <> quiet_end)
);

create index crm_notification_preferences_user_workspace_idx
  on public.crm_notification_preferences (user_id, workspace_id);

alter table public.crm_notification_preferences enable row level security;

revoke all on table public.crm_notification_preferences
  from public, anon, authenticated;
grant select, insert, update on table public.crm_notification_preferences
  to authenticated;
grant all on table public.crm_notification_preferences to service_role;

create policy "Users read only their notification preferences"
  on public.crm_notification_preferences for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = crm_notification_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Users create only their notification preferences"
  on public.crm_notification_preferences for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = crm_notification_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Users update only their notification preferences"
  on public.crm_notification_preferences for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = crm_notification_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = crm_notification_preferences.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

-- Postgres Changes is adequate for this small, private team feed. It respects
-- the existing notification SELECT policy, while the one-minute poll remains
-- as a recovery path if a browser WebSocket sleeps or disconnects.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crm_notifications'
  ) then
    alter publication supabase_realtime add table public.crm_notifications;
  end if;
end
$$;

comment on column public.crm_notifications.snoozed_until is
  'When set, the receipt stays out of active unread counts and popups until this time.';
comment on column public.crm_notifications.attention_at is
  'Created time or latest snooze return time, used to surface an alert exactly once.';
comment on table public.crm_notification_preferences is
  'Per-user alert delivery choices. Notification history remains canonical and is never deleted by muting alerts.';
