-- One physical Recall bot may serve several teammates who are independently
-- authorised for the same scheduled calendar occurrence. The bot owns one
-- canonical raw transcript. Each teammate keeps a private LiveCoach session,
-- intent, cue stream, notes and summary.

alter table public.meet_bots
  add column if not exists meeting_instance_key text,
  add column if not exists source_upcoming_id uuid
    references public.upcoming_calls(id) on delete set null;

alter table public.meet_bots
  drop constraint if exists meet_bots_meeting_instance_key_check,
  add constraint meet_bots_meeting_instance_key_check
    check (
      meeting_instance_key is null
      or meeting_instance_key ~ '^[0-9a-f]{64}$'
    ) not valid;

alter table public.meet_bots
  validate constraint meet_bots_meeting_instance_key_check;

-- The former index limited the capture owner to one provider bot. Concurrency
-- now belongs to private subscriptions instead, so the first teammate may end
-- their own coaching session while the shared bot remains for somebody else.
drop index if exists public.meet_bots_one_active_per_owner_uidx;

create unique index if not exists meet_bots_one_active_instance_uidx
  on public.meet_bots (workspace_id, meeting_instance_key)
  where status = 'active' and meeting_instance_key is not null;

create index if not exists meet_bots_instance_status_idx
  on public.meet_bots (workspace_id, meeting_instance_key, status, created_at desc)
  where meeting_instance_key is not null;

create table if not exists public.meet_capture_subscribers (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.meet_bots(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  upcoming_id uuid references public.upcoming_calls(id) on delete set null,
  status text not null default 'active',
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint meet_capture_subscribers_session_check
    check (session_id ~ '^lc-[a-z0-9-]{6,80}$'),
  constraint meet_capture_subscribers_status_check
    check (status in ('active', 'ended')),
  constraint meet_capture_subscribers_visibility_check
    check (visibility = 'private'),
  unique (owner_id, session_id)
);

create unique index if not exists meet_capture_subscribers_one_active_owner_uidx
  on public.meet_capture_subscribers (workspace_id, owner_id)
  where status = 'active';

create unique index if not exists meet_capture_subscribers_capture_owner_session_uidx
  on public.meet_capture_subscribers (capture_id, owner_id, session_id);

create index if not exists meet_capture_subscribers_capture_status_idx
  on public.meet_capture_subscribers (capture_id, status, created_at);

alter table public.meet_capture_subscribers enable row level security;
revoke all on public.meet_capture_subscribers from public, anon, authenticated;
grant select on public.meet_capture_subscribers to authenticated;
grant select, insert, update, delete on public.meet_capture_subscribers to service_role;

drop policy if exists "Owners read their Meet capture subscription"
  on public.meet_capture_subscribers;
create policy "Owners read their Meet capture subscription"
  on public.meet_capture_subscribers
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = meet_capture_subscribers.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

comment on table public.meet_capture_subscribers is
  'Private per-user coaching sessions authorised to receive one canonical Recall capture.';
comment on column public.meet_bots.meeting_instance_key is
  'Server-generated hash of an exact verified calendar occurrence and its normalised meeting URL.';
comment on column public.meet_bots.source_upcoming_id is
  'Private scheduled-call record used by the teammate who created the shared capture.';
comment on table public.meet_utterances is
  'Canonical Recall utterances stored once under the capture owner. Authorised subscribers read them through the scoped server route.';

-- Preserve any active bot created immediately before this deployment. New
-- inserts are also seeded by the trigger below, which makes a rolling app and
-- database deployment safe.
insert into public.meet_capture_subscribers (
  capture_id,
  workspace_id,
  owner_id,
  session_id,
  status,
  visibility
)
select
  mb.id,
  mb.workspace_id,
  mb.owner_id,
  mb.session_id,
  'active',
  'private'
from public.meet_bots mb
where mb.status = 'active'
on conflict (owner_id, session_id) do nothing;

create or replace function public.seed_meet_capture_owner_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    insert into public.meet_capture_subscribers (
      capture_id,
      workspace_id,
      owner_id,
      session_id,
      upcoming_id,
      status,
      visibility
    ) values (
      new.id,
      new.workspace_id,
      new.owner_id,
      new.session_id,
      new.source_upcoming_id,
      'active',
      'private'
    )
    on conflict (owner_id, session_id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.seed_meet_capture_owner_subscription()
  from public, anon, authenticated;
grant execute on function public.seed_meet_capture_owner_subscription()
  to service_role;

drop trigger if exists trg_seed_meet_capture_owner_subscription
  on public.meet_bots;
create trigger trg_seed_meet_capture_owner_subscription
after insert on public.meet_bots
for each row execute function public.seed_meet_capture_owner_subscription();

-- A personal summary ends only that user's subscription. The capture row is
-- closed only when no authorised teammate remains. The normal API stop path
-- also tells Recall to leave. This trigger is the database safety fallback.
create or replace function public.close_meet_bots_on_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_id is not null then
    update public.meet_capture_subscribers
       set status = 'ended',
           ended_at = coalesce(ended_at, now()),
           updated_at = now()
     where workspace_id = new.workspace_id
       and owner_id = new.owner_id
       and session_id = new.session_id
       and status = 'active';

    update public.meet_bots mb
       set status = 'left',
           ended_at = coalesce(mb.ended_at, now())
     where mb.status = 'active'
       and exists (
         select 1
         from public.meet_capture_subscribers mine
         where mine.capture_id = mb.id
           and mine.workspace_id = new.workspace_id
           and mine.owner_id = new.owner_id
           and mine.session_id = new.session_id
       )
       and not exists (
         select 1
         from public.meet_capture_subscribers active_subscriber
         where active_subscriber.capture_id = mb.id
           and active_subscriber.status = 'active'
       );
  end if;
  return new;
end;
$$;

revoke execute on function public.close_meet_bots_on_summary()
  from public, anon, authenticated;
grant execute on function public.close_meet_bots_on_summary()
  to service_role;
