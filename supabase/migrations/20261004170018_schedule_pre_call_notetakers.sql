-- Schedule Recall bots when a calendar event is synced instead of polling the
-- entire workspace every minute. Future subscriptions remain non-active until
-- the salesperson opens that call, so several upcoming meetings can be safely
-- reserved without blocking a live coaching session.

alter table public.meet_bots
  add column if not exists scheduled_join_at timestamptz,
  add column if not exists scheduled_meeting_url text;

create index if not exists meet_bots_scheduled_join_idx
  on public.meet_bots (workspace_id, scheduled_join_at)
  where status = 'active' and scheduled_join_at is not null;

create unique index if not exists meet_bots_one_scheduled_upcoming_uidx
  on public.meet_bots (workspace_id, source_upcoming_id, scheduled_join_at, scheduled_meeting_url)
  where status = 'active'
    and scheduled_join_at is not null
    and source_upcoming_id is not null;

comment on column public.meet_bots.scheduled_join_at is
  'Provider-side Recall join time. Null means the bot was requested immediately.';

alter table public.meet_capture_subscribers
  drop constraint if exists meet_capture_subscribers_status_check,
  add constraint meet_capture_subscribers_status_check
    check (status in ('scheduled', 'active', 'ended')) not valid;

alter table public.meet_capture_subscribers
  validate constraint meet_capture_subscribers_status_check;

create or replace function public.seed_meet_capture_owner_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_status text;
begin
  if new.status = 'active' then
    subscription_status := case
      when new.scheduled_join_at is not null
       and new.scheduled_join_at > now()
        then 'scheduled'
      else 'active'
    end;

    insert into public.meet_capture_subscribers (
      capture_id,
      workspace_id,
      owner_id,
      session_id,
      upcoming_id,
      status,
      visibility,
      ended_at,
      updated_at
    ) values (
      new.id,
      new.workspace_id,
      new.owner_id,
      new.session_id,
      new.source_upcoming_id,
      subscription_status,
      'private',
      null,
      now()
    )
    on conflict (owner_id, session_id) do update
      set capture_id = excluded.capture_id,
          workspace_id = excluded.workspace_id,
          upcoming_id = excluded.upcoming_id,
          status = excluded.status,
          visibility = 'private',
          ended_at = null,
          updated_at = now();
  end if;
  return new;
end;
$$;

revoke execute on function public.seed_meet_capture_owner_subscription()
  from public, anon, authenticated;
grant execute on function public.seed_meet_capture_owner_subscription()
  to service_role;

comment on constraint meet_capture_subscribers_status_check
  on public.meet_capture_subscribers is
  'Scheduled reservations do not consume the one-active-call allowance.';

-- A summary belongs to one account. An unattended scheduled subscriber is
-- still entitled to the shared capture, just like an active browser session.
create or replace function public.close_meet_bots_on_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_id is not null then
    update public.meet_capture_subscribers
       set status = 'ended', ended_at = coalesce(ended_at, now()), updated_at = now()
     where workspace_id = new.workspace_id
       and owner_id = new.owner_id
       and session_id = new.session_id
       and status in ('scheduled', 'active');

    update public.meet_bots mb
       set status = 'left', ended_at = coalesce(mb.ended_at, now())
     where mb.status = 'active'
       and mb.workspace_id = new.workspace_id
       and exists (
         select 1 from public.meet_capture_subscribers mine
          where mine.capture_id = mb.id
            and mine.workspace_id = new.workspace_id
            and mine.owner_id = new.owner_id
            and mine.session_id = new.session_id
       )
       and not exists (
         select 1 from public.meet_capture_subscribers remaining
          where remaining.capture_id = mb.id
            and remaining.workspace_id = mb.workspace_id
            and remaining.status in ('scheduled', 'active')
       );
  end if;
  return new;
end;
$$;

revoke execute on function public.close_meet_bots_on_summary()
  from public, anon, authenticated;
grant execute on function public.close_meet_bots_on_summary() to service_role;
