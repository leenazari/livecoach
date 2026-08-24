-- User-scoped CRM notifications are delivery receipts for canonical activity.
-- They never become a second source of truth for replies or assignments.
create table public.crm_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('outreach_reply', 'lead_assigned')),
  title text not null check (length(title) between 1 and 160),
  body text not null default '' check (length(body) <= 1000),
  href text check (href is null or (href like '/%' and length(href) <= 500)),
  source_table text not null check (
    source_table in ('outreach_prospects', 'opportunities')
  ),
  source_id text not null check (length(source_id) between 1 and 160),
  source_event_key text not null check (length(source_event_key) between 1 and 300),
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source_event_key)
);

create index crm_notifications_user_unread_created_idx
  on public.crm_notifications (user_id, workspace_id, read_at, created_at desc)
  where dismissed_at is null;

alter table public.crm_notifications enable row level security;

revoke all on table public.crm_notifications from public, anon, authenticated;
grant select on table public.crm_notifications to authenticated;
grant update (read_at, dismissed_at) on table public.crm_notifications
  to authenticated;
grant all on table public.crm_notifications to service_role;

create policy "Users read only their notifications"
  on public.crm_notifications for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = crm_notifications.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Users update only their notification state"
  on public.crm_notifications for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = crm_notifications.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = crm_notifications.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

-- Trigger functions live outside the exposed public schema. They need
-- elevated insert access because the assigning manager must be able to create
-- a notification owned by the assignee, while no browser client can forge one.
create schema if not exists livecoach_private;
revoke all on schema livecoach_private from public, anon, authenticated;

create or replace function livecoach_private.notify_work_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  recipient_id uuid;
  target_uuid uuid;
  current_assignee uuid;
  actor_role text;
  target_label text;
  target_href text;
begin
  if new.action <> 'work_assignment_changed' then
    return new;
  end if;

  begin
    recipient_id := nullif(new.next_scope ->> 'assignedToUserId', '')::uuid;
    target_uuid := nullif(new.target_id, '')::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  if recipient_id is null or target_uuid is null
    or recipient_id = new.actor_user_id then
    return new;
  end if;

  if new.actor_user_id is not null then
    select wm.role into actor_role
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.actor_user_id
      and wm.status = 'active';
    if actor_role is null or actor_role not in ('owner', 'manager') then
      return new;
    end if;
  end if;

  if new.target_table = 'outreach_prospects' then
    select
      prospect.assigned_to_user_id,
      concat_ws(
        ' · ',
        nullif(trim(concat_ws(' ', prospect.first_name, prospect.last_name)), ''),
        nullif(trim(prospect.company_name), '')
      )
    into current_assignee, target_label
    from public.outreach_prospects prospect
    where prospect.id = target_uuid
      and prospect.workspace_id = new.workspace_id;
    target_href := '/crm/outreach?tab=prospects';
  elsif new.target_table = 'opportunities' then
    select opportunity.assigned_to_user_id, nullif(trim(opportunity.title), '')
    into current_assignee, target_label
    from public.opportunities opportunity
    where opportunity.id = target_uuid
      and opportunity.workspace_id = new.workspace_id;
    target_href := '/crm/revenue';
  else
    return new;
  end if;

  if current_assignee is distinct from recipient_id or not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = recipient_id
      and wm.status = 'active'
  ) then
    return new;
  end if;

  insert into public.crm_notifications (
    workspace_id,
    user_id,
    kind,
    title,
    body,
    href,
    source_table,
    source_id,
    source_event_key,
    created_at
  ) values (
    new.workspace_id,
    recipient_id,
    'lead_assigned',
    'New lead assigned to you',
    left(coalesce(target_label, 'A shared sales record is now assigned to you.'), 1000),
    target_href,
    new.target_table,
    target_uuid::text,
    'lead_assignment:' || new.id::text,
    new.created_at
  )
  on conflict (user_id, source_event_key) do nothing;

  return new;
end;
$$;

drop trigger if exists access_audit_notify_work_assignment
  on public.access_audit_events;
create trigger access_audit_notify_work_assignment
  after insert on public.access_audit_events
  for each row
  when (new.action = 'work_assignment_changed')
  execute function livecoach_private.notify_work_assignment();

create or replace function livecoach_private.notify_outreach_reply()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  recipient_id uuid := new.assigned_to_user_id;
  reply_title text;
  reply_body text;
begin
  if new.last_reply_at is null
    or new.last_reply_at is not distinct from old.last_reply_at
    or recipient_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = recipient_id
      and wm.status = 'active'
  ) then
    return new;
  end if;

  reply_title := case new.reply_category
    when 'interested' then 'Positive outreach reply'
    when 'objection' then 'New outreach objection'
    when 'later' then 'Prospect replied for later'
    when 'referral' then 'New referral reply'
    when 'unsubscribe' then 'Prospect asked to stop'
    else 'New outreach reply'
  end;
  reply_body := concat_ws(
    ' · ',
    nullif(trim(concat_ws(' ', new.first_name, new.last_name)), ''),
    nullif(trim(new.company_name), ''),
    nullif(trim(new.reply_summary), '')
  );

  insert into public.crm_notifications (
    workspace_id,
    user_id,
    kind,
    title,
    body,
    href,
    source_table,
    source_id,
    source_event_key
  ) values (
    new.workspace_id,
    recipient_id,
    'outreach_reply',
    reply_title,
    left(coalesce(reply_body, 'A new outreach reply is ready to review.'), 1000),
    '/crm/outreach?tab=replies',
    'outreach_prospects',
    new.id::text,
    'outreach_reply:' || new.id::text || ':' || new.last_reply_at::text
  )
  on conflict (user_id, source_event_key) do nothing;

  return new;
end;
$$;

drop trigger if exists outreach_prospects_notify_reply
  on public.outreach_prospects;
create trigger outreach_prospects_notify_reply
  after update of last_reply_at on public.outreach_prospects
  for each row execute function livecoach_private.notify_outreach_reply();

revoke execute on function livecoach_private.notify_work_assignment()
  from public, anon, authenticated;
revoke execute on function livecoach_private.notify_outreach_reply()
  from public, anon, authenticated;

comment on table public.crm_notifications is
  'Per-user delivery and read state for canonical CRM events. Source replies and assignments remain authoritative.';
