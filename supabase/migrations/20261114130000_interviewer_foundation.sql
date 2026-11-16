-- Hidden Interviewer section.
-- Additive only: new tables, functions and a private storage bucket.
-- Nothing here is applied by the application deploy. Apply it to a Supabase
-- branch first. Live outreach, calls and campaigns do not read these tables.
--
-- Slot capacity is global (default 43). A slot whose heartbeat is older than
-- 45 seconds is released lazily. Queue offers are FIFO, with a priority flag
-- for someone Deepgram refused, and a 60-second offer window.

create table if not exists public.interviewer_config (
  id integer primary key check (id = 1),
  max_concurrent_slots integer not null default 43 check (max_concurrent_slots between 1 and 500),
  heartbeat_stale_seconds integer not null default 45 check (heartbeat_stale_seconds between 15 and 300),
  offer_window_seconds integer not null default 60 check (offer_window_seconds between 15 and 300),
  updated_at timestamptz not null default now()
);

insert into public.interviewer_config (id)
values (1)
on conflict (id) do nothing;

comment on table public.interviewer_config is
  'Global interviewer capacity. max_concurrent_slots defaults to 43.';

create table if not exists public.interviewer_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

comment on table public.interviewer_access is
  'Who may open the hidden interviewer section. Seeded for active owners only.';

insert into public.interviewer_access (workspace_id, user_id)
select workspace_id, user_id
from public.workspace_members
where role = 'owner' and status = 'active'
on conflict (workspace_id, user_id) do nothing;

create table if not exists public.interviewer_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 160),
  persona_override text check (persona_override is null or length(persona_override) <= 4000),
  prompt_override text check (prompt_override is null or length(prompt_override) <= 8000),
  voice_id text not null default 'aura-2-pandora-en'
    check (voice_id in ('aura-2-draco-en', 'aura-2-pandora-en')),
  max_minutes integer check (max_minutes is null or max_minutes between 1 and 180),
  rate_per_minute numeric(12, 4) not null default 0 check (rate_per_minute >= 0),
  currency text not null default 'GBP' check (currency in ('GBP', 'USD', 'EUR')),
  margin_percent numeric(5, 2) not null default 0 check (margin_percent >= 0 and margin_percent < 100),
  billing_granularity text not null default 'second' check (billing_granularity in ('second', 'minute')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (workspace_id, owner_id)
    references public.workspace_members(workspace_id, user_id)
);

comment on column public.interviewer_campaigns.rate_per_minute is
  'Customer rate per connected minute. Margin is already included in this figure.';
comment on column public.interviewer_campaigns.margin_percent is
  'Share of rate_per_minute that is margin, stored so the owner can see it. Not added on top.';
comment on column public.interviewer_campaigns.max_minutes is
  'Null means the conversation has no time cap.';
comment on column public.interviewer_campaigns.voice_id is
  'Deepgram Aura-2 voice. aura-2-draco-en is the British male voice. aura-2-pandora-en is the British female voice.';

create table if not exists public.interviewer_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  token uuid not null default gen_random_uuid(),
  prospect_name text check (prospect_name is null or length(trim(prospect_name)) between 1 and 160),
  prospect_email text check (prospect_email is null or length(prospect_email) <= 254),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (token),
  unique (id, workspace_id),
  foreign key (campaign_id, workspace_id)
    references public.interviewer_campaigns(id, workspace_id) on delete cascade
);

create index if not exists interviewer_invites_campaign_idx
  on public.interviewer_invites (campaign_id, created_at desc);

comment on column public.interviewer_invites.token is
  'Unguessable bearer for /i/[token]. The invite id is not the secret.';

create table if not exists public.interviewer_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  invite_id uuid not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'connected', 'ended', 'abandoned')),
  started_at timestamptz not null default now(),
  connected_at timestamptz,
  ended_at timestamptz,
  billable_seconds integer check (billable_seconds is null or billable_seconds >= 0),
  billed_amount numeric(12, 4) check (billed_amount is null or billed_amount >= 0),
  disposition text check (
    disposition is null or disposition in (
      'Hot', 'Warm', 'Nurture', 'Bounced', 'Wrong number',
      'Competitor chosen', 'Timing push', 'Closed lost'
    )
  ),
  reason_code text check (reason_code is null or length(trim(reason_code)) between 1 and 160),
  timing_target_date date,
  timing_precision text check (
    timing_precision is null or timing_precision in ('day', 'week', 'month', 'quarter', 'year', 'unknown')
  ),
  timing_raw_quote text check (timing_raw_quote is null or length(timing_raw_quote) <= 500),
  recording_path text check (recording_path is null or length(recording_path) <= 400),
  calendar_event_id text check (calendar_event_id is null or length(calendar_event_id) <= 200),
  calendar_scheduled_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (invite_id, workspace_id)
    references public.interviewer_invites(id, workspace_id) on delete cascade,
  foreign key (campaign_id, workspace_id)
    references public.interviewer_campaigns(id, workspace_id) on delete cascade,
  check (connected_at is null or connected_at >= started_at - interval '5 minutes'),
  check (ended_at is null or connected_at is null or ended_at >= connected_at),
  unique (id, workspace_id)
);

comment on column public.interviewer_sessions.started_at is
  'When the session opened, which may include queue time. Not billable.';
comment on column public.interviewer_sessions.connected_at is
  'When the voice connection was allowed. Billable time starts here and never includes the queue.';
comment on column public.interviewer_sessions.billable_seconds is
  'Connected seconds only, capped by the campaign max_minutes when one is set.';

create index if not exists interviewer_sessions_campaign_idx
  on public.interviewer_sessions (campaign_id, created_at desc);

create index if not exists interviewer_sessions_invite_open_idx
  on public.interviewer_sessions (invite_id, created_at desc)
  where ended_at is null;

create table if not exists public.interviewer_utterances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  session_id uuid not null,
  speaker text not null check (speaker in ('agent', 'lead')),
  text text not null check (length(trim(text)) between 1 and 4000),
  ts timestamptz not null default now(),
  client_key text check (client_key is null or length(client_key) between 8 and 80),
  created_at timestamptz not null default now(),
  foreign key (session_id, workspace_id)
    references public.interviewer_sessions(id, workspace_id) on delete cascade
);

create unique index if not exists interviewer_utterances_client_key_idx
  on public.interviewer_utterances (session_id, client_key)
  where client_key is not null;

create index if not exists interviewer_utterances_session_ts_idx
  on public.interviewer_utterances (session_id, ts);

create table if not exists public.interviewer_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 20000),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, workspace_id)
    references public.interviewer_campaigns(id, workspace_id) on delete cascade
);

create index if not exists interviewer_documents_campaign_idx
  on public.interviewer_documents (campaign_id, created_at);

create table if not exists public.interviewer_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invite_id uuid not null,
  session_id uuid not null unique,
  joined_at timestamptz not null default now(),
  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'claimed', 'expired', 'left')),
  offered_at timestamptz,
  offer_expires_at timestamptz,
  priority boolean not null default false,
  priority_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (session_id, workspace_id)
    references public.interviewer_sessions(id, workspace_id) on delete cascade,
  foreign key (invite_id, workspace_id)
    references public.interviewer_invites(id, workspace_id) on delete cascade,
  check (priority = false or priority_at is not null),
  check (status <> 'offered' or offer_expires_at is not null)
);

create index if not exists interviewer_queue_fifo_idx
  on public.interviewer_queue (status, priority desc, priority_at asc, joined_at asc);

comment on column public.interviewer_queue.priority is
  'Front-of-queue flag. Set when Deepgram refuses the connection for concurrency.';

create table if not exists public.interviewer_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  session_id uuid not null,
  invite_id uuid not null,
  status text not null default 'active' check (status in ('active', 'released', 'expired')),
  claimed_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  released_at timestamptz,
  foreign key (session_id, workspace_id)
    references public.interviewer_sessions(id, workspace_id) on delete cascade,
  foreign key (invite_id, workspace_id)
    references public.interviewer_invites(id, workspace_id) on delete cascade
);

create unique index if not exists interviewer_slots_one_active_session_idx
  on public.interviewer_slots (session_id)
  where status = 'active';

create index if not exists interviewer_slots_active_heartbeat_idx
  on public.interviewer_slots (last_heartbeat_at)
  where status = 'active';

comment on table public.interviewer_slots is
  'One active row is one live Deepgram seat. Heartbeats older than the config window are released lazily.';

-- Private recordings. No anon or authenticated storage policy: the server
-- signs uploads and playback after it has checked the invite or the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interviewer-recordings',
  'interviewer-recordings',
  false,
  104857600,
  array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'video/webm']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.interviewer_caller_can_access(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.interviewer_access access_row
    join public.workspace_members member_row
      on member_row.workspace_id = access_row.workspace_id
     and member_row.user_id = access_row.user_id
    where access_row.workspace_id = p_workspace
      and access_row.user_id = auth.uid()
      and member_row.role = 'owner'
      and member_row.status = 'active'
  );
$$;

create or replace function public.interviewer_take_lock()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Two-int form: hashtext is int4, and the single-bigint lock is a different signature.
  perform pg_advisory_xact_lock(hashtext('livecoach.interviewer'), hashtext('slots'));
end;
$$;

create or replace function public.interviewer_finish_session(
  p_session_id uuid,
  p_ended_at timestamptz,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connected timestamptz;
  v_max_minutes integer;
  v_rate numeric;
  v_granularity text;
  v_seconds integer;
  v_amount numeric;
begin
  select session_row.connected_at, campaign_row.max_minutes, campaign_row.rate_per_minute, campaign_row.billing_granularity
    into v_connected, v_max_minutes, v_rate, v_granularity
  from public.interviewer_sessions session_row
  join public.interviewer_campaigns campaign_row on campaign_row.id = session_row.campaign_id
  where session_row.id = p_session_id
    and session_row.ended_at is null
  for update of session_row;

  if not found then
    return;
  end if;

  if v_connected is null or p_status = 'abandoned' then
    update public.interviewer_sessions
    set status = 'abandoned',
        ended_at = p_ended_at,
        billable_seconds = 0,
        billed_amount = 0
    where id = p_session_id;
    return;
  end if;

  v_seconds := greatest(0, floor(extract(epoch from (p_ended_at - v_connected))))::integer;
  if v_max_minutes is not null then
    v_seconds := least(v_seconds, v_max_minutes * 60);
  end if;
  if v_granularity = 'minute' then
    v_amount := ceil(v_seconds / 60.0) * v_rate;
  else
    v_amount := (v_seconds / 60.0) * v_rate;
  end if;

  update public.interviewer_sessions
  set status = 'ended',
      ended_at = p_ended_at,
      billable_seconds = v_seconds,
      billed_amount = round(v_amount, 4)
  where id = p_session_id;
end;
$$;

create or replace function public.interviewer_lazy_release_slots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stale integer;
  v_slot record;
begin
  select heartbeat_stale_seconds into v_stale from public.interviewer_config where id = 1;
  if v_stale is null then
    v_stale := 45;
  end if;

  for v_slot in
    select id, session_id, last_heartbeat_at
    from public.interviewer_slots
    where status = 'active'
      and last_heartbeat_at < now() - make_interval(secs => v_stale)
    for update
  loop
    update public.interviewer_slots
    set status = 'expired', released_at = now()
    where id = v_slot.id and status = 'active';

    perform public.interviewer_finish_session(v_slot.session_id, v_slot.last_heartbeat_at, 'ended');

    update public.interviewer_queue
    set status = 'left', updated_at = now()
    where session_id = v_slot.session_id
      and status in ('waiting', 'offered', 'claimed');
  end loop;
end;
$$;

create or replace function public.advance_interviewer_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_slots integer;
  v_window integer;
  v_active integer;
  v_offers integer;
  v_room integer;
begin
  perform public.interviewer_take_lock();
  perform public.interviewer_lazy_release_slots();

  select max_concurrent_slots, offer_window_seconds
    into v_max_slots, v_window
  from public.interviewer_config
  where id = 1;
  if v_max_slots is null then
    v_max_slots := 43;
  end if;
  if v_window is null then
    v_window := 60;
  end if;

  -- A missed offer goes to the back. The next person is offered below.
  update public.interviewer_queue
  set status = 'waiting',
      priority = false,
      priority_at = null,
      offered_at = null,
      offer_expires_at = null,
      joined_at = now(),
      updated_at = now()
  where status = 'offered'
    and offer_expires_at <= now();

  select count(*) into v_active from public.interviewer_slots where status = 'active';
  select count(*) into v_offers
  from public.interviewer_queue
  where status = 'offered' and offer_expires_at > now();

  v_room := v_max_slots - v_active - v_offers;
  if v_room <= 0 then
    return;
  end if;

  update public.interviewer_queue queue_row
  set status = 'offered',
      offered_at = now(),
      offer_expires_at = now() + make_interval(secs => v_window),
      updated_at = now()
  where queue_row.id in (
    select picked.id
    from public.interviewer_queue picked
    where picked.status = 'waiting'
    order by picked.priority desc, picked.priority_at asc nulls last, picked.joined_at asc, picked.id asc
    limit v_room
    for update skip locked
  );
end;
$$;

create or replace function public.interviewer_queue_position(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, priority, priority_at, joined_at, status
    from public.interviewer_queue
    where session_id = p_session_id
  )
  select case
    when me.status in ('claimed', 'left', 'expired') then 0
    else 1 + (
      select count(*)
      from public.interviewer_queue other
      cross join me
      where other.status in ('waiting', 'offered')
        and other.id <> me.id
        and (
          other.priority > me.priority
          or (other.priority = me.priority and coalesce(other.priority_at, other.joined_at) < coalesce(me.priority_at, me.joined_at))
          or (
            other.priority = me.priority
            and coalesce(other.priority_at, other.joined_at) = coalesce(me.priority_at, me.joined_at)
            and (other.joined_at, other.id) < (me.joined_at, me.id)
          )
        )
    )
  end::integer
  from me;
$$;

create or replace function public.interviewer_queue_state(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.interviewer_queue%rowtype;
  v_slot uuid;
begin
  select * into v_row from public.interviewer_queue where session_id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_joined');
  end if;
  select id into v_slot
  from public.interviewer_slots
  where session_id = p_session_id and status = 'active'
  limit 1;
  return jsonb_build_object(
    'ok', true,
    'sessionId', p_session_id,
    'queueStatus', v_row.status,
    'position', public.interviewer_queue_position(p_session_id),
    'priority', v_row.priority,
    'offeredAt', v_row.offered_at,
    'offerExpiresAt', v_row.offer_expires_at,
    'slotId', v_slot,
    'state', case
      when v_slot is not null then 'claimed'
      when v_row.status = 'offered' then 'offered'
      when v_row.status = 'left' then 'left'
      else 'queued'
    end
  );
end;
$$;

create or replace function public.claim_interviewer_slot(
  p_token uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.interviewer_invites%rowtype;
  v_session public.interviewer_sessions%rowtype;
  v_queue public.interviewer_queue%rowtype;
  v_slot_id uuid;
  v_max_slots integer;
  v_active integer;
  v_others integer;
begin
  perform public.interviewer_take_lock();
  if p_token is null then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  select * into v_invite from public.interviewer_invites where token = p_token;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  perform public.interviewer_lazy_release_slots();

  if p_session_id is not null then
    select * into v_session
    from public.interviewer_sessions
    where id = p_session_id and invite_id = v_invite.id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'unavailable');
    end if;
  else
    select * into v_session
    from public.interviewer_sessions
    where invite_id = v_invite.id
      and ended_at is null
      and status in ('waiting', 'connected')
    order by created_at desc
    limit 1;
  end if;

  if v_session.id is not null and v_session.ended_at is not null then
    v_session := null;
  end if;

  if v_session.id is null then
    insert into public.interviewer_sessions (
      workspace_id, campaign_id, invite_id, status, started_at, last_heartbeat_at
    ) values (
      v_invite.workspace_id, v_invite.campaign_id, v_invite.id, 'waiting', now(), now()
    )
    returning * into v_session;
  end if;

  select id into v_slot_id
  from public.interviewer_slots
  where session_id = v_session.id and status = 'active'
  limit 1;
  if v_slot_id is not null then
    return public.interviewer_queue_state(v_session.id) || jsonb_build_object('slotId', v_slot_id, 'state', 'claimed');
  end if;

  insert into public.interviewer_queue (
    workspace_id, invite_id, session_id, status, joined_at
  ) values (
    v_invite.workspace_id, v_invite.id, v_session.id, 'waiting', now()
  )
  on conflict (session_id) do nothing;

  select * into v_queue from public.interviewer_queue where session_id = v_session.id for update;
  if v_queue.status = 'left' or (v_queue.status = 'claimed' and v_slot_id is null) then
    update public.interviewer_queue
    set status = 'waiting',
        priority = case when v_queue.status = 'claimed' then v_queue.priority else false end,
        priority_at = case when v_queue.status = 'claimed' then v_queue.priority_at else null end,
        offered_at = null,
        offer_expires_at = null,
        joined_at = case when v_queue.status = 'left' then now() else v_queue.joined_at end,
        updated_at = now()
    where id = v_queue.id;
  end if;

  perform public.advance_interviewer_queue();

  select max_concurrent_slots into v_max_slots from public.interviewer_config where id = 1;
  if v_max_slots is null then
    v_max_slots := 43;
  end if;
  select count(*) into v_active from public.interviewer_slots where status = 'active';
  select * into v_queue from public.interviewer_queue where session_id = v_session.id;

  select count(*) into v_others
  from public.interviewer_queue
  where status in ('waiting', 'offered')
    and session_id <> v_session.id;

  if v_active < v_max_slots and (
    v_queue.status = 'offered'
    or (v_queue.status = 'waiting' and v_others = 0)
  ) then
    insert into public.interviewer_slots (
      workspace_id, session_id, invite_id, status, claimed_at, last_heartbeat_at
    ) values (
      v_invite.workspace_id, v_session.id, v_invite.id, 'active', now(), now()
    )
    returning id into v_slot_id;

    update public.interviewer_queue
    set status = 'claimed', updated_at = now()
    where session_id = v_session.id;

    update public.interviewer_sessions
    set last_heartbeat_at = now()
    where id = v_session.id;

    return public.interviewer_queue_state(v_session.id)
      || jsonb_build_object('slotId', v_slot_id, 'state', 'claimed');
  end if;

  return public.interviewer_queue_state(v_session.id);
end;
$$;

create or replace function public.release_interviewer_slot(
  p_token uuid,
  p_session_id uuid,
  p_reason text default 'ended'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
  v_connected timestamptz;
begin
  perform public.interviewer_take_lock();
  select invite_row.id, session_row.connected_at
    into v_invite_id, v_connected
  from public.interviewer_sessions session_row
  join public.interviewer_invites invite_row on invite_row.id = session_row.invite_id
  where session_row.id = p_session_id
    and invite_row.token = p_token;
  if v_invite_id is null then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  update public.interviewer_slots
  set status = 'released', released_at = now()
  where session_id = p_session_id and status = 'active';

  if p_reason = 'retry' then
    update public.interviewer_queue
    set status = 'waiting',
        offered_at = null,
        offer_expires_at = null,
        updated_at = now()
    where session_id = p_session_id
      and status in ('claimed', 'offered', 'waiting');
    if v_connected is not null and v_connected > now() - interval '30 seconds' then
      update public.interviewer_sessions
      set status = 'waiting', connected_at = null
      where id = p_session_id and ended_at is null;
    end if;
  elsif p_reason = 'left' then
    update public.interviewer_queue
    set status = 'left', updated_at = now()
    where session_id = p_session_id and status <> 'left';
    perform public.interviewer_finish_session(
      p_session_id,
      now(),
      case when v_connected is null then 'abandoned' else 'ended' end
    );
  else
    update public.interviewer_queue
    set status = 'left', updated_at = now()
    where session_id = p_session_id and status in ('waiting', 'offered', 'claimed');
    perform public.interviewer_finish_session(p_session_id, now(), 'ended');
  end if;

  perform public.advance_interviewer_queue();
  return public.interviewer_queue_state(p_session_id) || jsonb_build_object('ok', true);
end;
$$;

create or replace function public.heartbeat_interviewer_slot(
  p_token uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
begin
  select slot_row.id into v_slot_id
  from public.interviewer_slots slot_row
  join public.interviewer_sessions session_row on session_row.id = slot_row.session_id
  join public.interviewer_invites invite_row on invite_row.id = session_row.invite_id
  where slot_row.session_id = p_session_id
    and slot_row.status = 'active'
    and invite_row.token = p_token
    and invite_row.revoked_at is null
    and invite_row.expires_at > now()
  for update of slot_row;

  if v_slot_id is null then
    return jsonb_build_object('ok', false, 'state', 'lost');
  end if;

  update public.interviewer_slots
  set last_heartbeat_at = now()
  where id = v_slot_id;

  update public.interviewer_sessions
  set last_heartbeat_at = now()
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'state', 'held', 'slotId', v_slot_id);
end;
$$;

create or replace function public.join_interviewer_queue(
  p_token uuid,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
begin
  -- Joining only queues. Claiming a seat is claim_interviewer_slot.
  v_state := public.claim_interviewer_slot(p_token, p_session_id);
  if coalesce(v_state->>'state', '') = 'claimed' and p_session_id is null then
    -- A brand-new join that found a free seat should still hold that seat:
    -- the public page claims explicitly. Keep the claim so a direct join is
    -- not worse than a claim. Callers that only wanted a place use status.
    return v_state;
  end if;
  perform public.advance_interviewer_queue();
  if v_state ? 'sessionId' then
    return public.interviewer_queue_state((v_state->>'sessionId')::uuid);
  end if;
  return v_state;
end;
$$;

create or replace function public.interviewer_queue_status(
  p_token uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
begin
  perform public.interviewer_take_lock();
  select invite_row.id into v_invite_id
  from public.interviewer_sessions session_row
  join public.interviewer_invites invite_row on invite_row.id = session_row.invite_id
  where session_row.id = p_session_id
    and invite_row.token = p_token
    and invite_row.revoked_at is null
    and invite_row.expires_at > now();
  if v_invite_id is null then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;
  perform public.advance_interviewer_queue();
  return public.interviewer_queue_state(p_session_id);
end;
$$;

create or replace function public.leave_interviewer_queue(
  p_token uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.release_interviewer_slot(p_token, p_session_id, 'left');
end;
$$;

create or replace function public.requeue_interviewer_priority(
  p_token uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
  v_connected timestamptz;
begin
  perform public.interviewer_take_lock();
  select invite_row.id, session_row.connected_at
    into v_invite_id, v_connected
  from public.interviewer_sessions session_row
  join public.interviewer_invites invite_row on invite_row.id = session_row.invite_id
  where session_row.id = p_session_id
    and invite_row.token = p_token
    and invite_row.revoked_at is null
    and invite_row.expires_at > now();
  if v_invite_id is null then
    return jsonb_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- A connection that already lasted is a real conversation. Keep its seat
  -- and its billable clock. Priority is for a refused connection.
  if v_connected is not null and v_connected <= now() - interval '30 seconds' then
    return public.interviewer_queue_state(p_session_id) || jsonb_build_object('state', 'in_call');
  end if;

  update public.interviewer_slots
  set status = 'released', released_at = now()
  where session_id = p_session_id and status = 'active';

  update public.interviewer_sessions
  set status = 'waiting', connected_at = null, last_heartbeat_at = now()
  where id = p_session_id and ended_at is null;

  update public.interviewer_queue
  set status = 'waiting',
      priority = true,
      priority_at = coalesce(priority_at, now()),
      offered_at = null,
      offer_expires_at = null,
      updated_at = now()
  where session_id = p_session_id;

  perform public.advance_interviewer_queue();
  return public.interviewer_queue_state(p_session_id) || jsonb_build_object('priority', true);
end;
$$;

create or replace function public.end_interviewer_session(
  p_token uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer;
  v_amount numeric;
begin
  perform public.release_interviewer_slot(p_token, p_session_id, 'ended');
  select billable_seconds, billed_amount into v_seconds, v_amount
  from public.interviewer_sessions
  where id = p_session_id;
  return jsonb_build_object(
    'ok', v_seconds is not null or v_amount is not null,
    'billableSeconds', coalesce(v_seconds, 0),
    'billedAmount', v_amount
  );
end;
$$;

revoke all on function public.interviewer_caller_can_access(uuid) from public, anon;
grant execute on function public.interviewer_caller_can_access(uuid) to authenticated, service_role;

revoke all on function public.interviewer_take_lock() from public, anon, authenticated;
revoke all on function public.interviewer_finish_session(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.interviewer_lazy_release_slots() from public, anon, authenticated;
revoke all on function public.advance_interviewer_queue() from public, anon, authenticated;
revoke all on function public.interviewer_queue_position(uuid) from public, anon, authenticated;
revoke all on function public.interviewer_queue_state(uuid) from public, anon, authenticated;
revoke all on function public.claim_interviewer_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_interviewer_slot(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.heartbeat_interviewer_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.join_interviewer_queue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.interviewer_queue_status(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_interviewer_queue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.requeue_interviewer_priority(uuid, uuid) from public, anon, authenticated;
revoke all on function public.end_interviewer_session(uuid, uuid) from public, anon, authenticated;

grant execute on function public.interviewer_take_lock() to service_role;
grant execute on function public.interviewer_finish_session(uuid, timestamptz, text) to service_role;
grant execute on function public.interviewer_lazy_release_slots() to service_role;
grant execute on function public.advance_interviewer_queue() to service_role;
grant execute on function public.interviewer_queue_position(uuid) to service_role;
grant execute on function public.interviewer_queue_state(uuid) to service_role;
grant execute on function public.claim_interviewer_slot(uuid, uuid) to service_role;
grant execute on function public.release_interviewer_slot(uuid, uuid, text) to service_role;
grant execute on function public.heartbeat_interviewer_slot(uuid, uuid) to service_role;
grant execute on function public.join_interviewer_queue(uuid, uuid) to service_role;
grant execute on function public.interviewer_queue_status(uuid, uuid) to service_role;
grant execute on function public.leave_interviewer_queue(uuid, uuid) to service_role;
grant execute on function public.requeue_interviewer_priority(uuid, uuid) to service_role;
grant execute on function public.end_interviewer_session(uuid, uuid) to service_role;

alter table public.interviewer_config enable row level security;
alter table public.interviewer_access enable row level security;
alter table public.interviewer_campaigns enable row level security;
alter table public.interviewer_invites enable row level security;
alter table public.interviewer_sessions enable row level security;
alter table public.interviewer_utterances enable row level security;
alter table public.interviewer_documents enable row level security;
alter table public.interviewer_queue enable row level security;
alter table public.interviewer_slots enable row level security;

revoke all on public.interviewer_config from anon;
revoke all on public.interviewer_access from anon;
revoke all on public.interviewer_campaigns from anon;
revoke all on public.interviewer_invites from anon;
revoke all on public.interviewer_sessions from anon;
revoke all on public.interviewer_utterances from anon;
revoke all on public.interviewer_documents from anon;
revoke all on public.interviewer_queue from anon;
revoke all on public.interviewer_slots from anon;

grant select on public.interviewer_config to authenticated, service_role;
grant select on public.interviewer_access to authenticated, service_role;
grant select, insert, update on public.interviewer_campaigns to authenticated, service_role;
grant select, insert, update on public.interviewer_invites to authenticated, service_role;
grant select, insert, update on public.interviewer_sessions to authenticated, service_role;
grant select, insert on public.interviewer_utterances to authenticated, service_role;
grant select, insert on public.interviewer_documents to authenticated, service_role;
grant select, update on public.interviewer_queue to authenticated, service_role;
grant select on public.interviewer_slots to authenticated, service_role;

drop policy if exists interviewer_config_owner_read on public.interviewer_config;
create policy interviewer_config_owner_read on public.interviewer_config
  for select to authenticated
  using (exists (
    select 1 from public.interviewer_access access_row
    where access_row.user_id = auth.uid()
  ));

drop policy if exists interviewer_access_read_own on public.interviewer_access;
create policy interviewer_access_read_own on public.interviewer_access
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists interviewer_campaigns_owner_read on public.interviewer_campaigns;
create policy interviewer_campaigns_owner_read on public.interviewer_campaigns
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_campaigns_owner_insert on public.interviewer_campaigns;
create policy interviewer_campaigns_owner_insert on public.interviewer_campaigns
  for insert to authenticated
  with check (
    public.interviewer_caller_can_access(workspace_id)
    and owner_id = auth.uid()
  );

drop policy if exists interviewer_campaigns_owner_update on public.interviewer_campaigns;
create policy interviewer_campaigns_owner_update on public.interviewer_campaigns
  for update to authenticated
  using (public.interviewer_caller_can_access(workspace_id))
  with check (
    public.interviewer_caller_can_access(workspace_id)
    and owner_id = auth.uid()
  );

drop policy if exists interviewer_invites_owner_select on public.interviewer_invites;
drop policy if exists interviewer_invites_owner_insert on public.interviewer_invites;
create policy interviewer_invites_owner_select on public.interviewer_invites
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));
create policy interviewer_invites_owner_insert on public.interviewer_invites
  for insert to authenticated
  with check (
    public.interviewer_caller_can_access(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists interviewer_sessions_owner_select on public.interviewer_sessions;
create policy interviewer_sessions_owner_select on public.interviewer_sessions
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_utterances_owner_select on public.interviewer_utterances;
create policy interviewer_utterances_owner_select on public.interviewer_utterances
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_documents_owner_select on public.interviewer_documents;
create policy interviewer_documents_owner_select on public.interviewer_documents
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));
create policy interviewer_documents_owner_insert on public.interviewer_documents
  for insert to authenticated
  with check (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_queue_owner_select on public.interviewer_queue;
create policy interviewer_queue_owner_select on public.interviewer_queue
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_slots_owner_select on public.interviewer_slots;
create policy interviewer_slots_owner_select on public.interviewer_slots
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));
