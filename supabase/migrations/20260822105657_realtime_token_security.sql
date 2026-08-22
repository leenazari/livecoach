-- Protect the in-app LiveKit and Deepgram paths without breaking public
-- candidate joining. Staff requests continue to use verified Supabase
-- workspace membership. A candidate receives a single-use invitation and,
-- after redemption, a short-lived opaque browser session. Only hashes are
-- stored and the table is never exposed through the public Data API.

-- A room is claimed by one workspace and one operator before any provider
-- token is minted. This prevents a member of another workspace from reusing a
-- room identifier they have learned. Room identifiers remain immutable even
-- after a call ends, so an old identifier can never cross an account boundary.
create table if not exists public.livekit_rooms (
  room_id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint livekit_rooms_room_check
    check (room_id ~ '^lc-[a-z0-9-]{6,80}$')
);

create index if not exists livekit_rooms_workspace_owner_idx
  on public.livekit_rooms (workspace_id, owner_id, created_at desc);

alter table public.livekit_rooms enable row level security;
revoke all on public.livekit_rooms from public, anon, authenticated;
grant select, insert, update, delete on public.livekit_rooms to service_role;

comment on table public.livekit_rooms is
  'Server-only immutable binding between a LiveKit room identifier, its workspace and its operator.';

create table if not exists public.livekit_join_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  room_id text not null references public.livekit_rooms(room_id) on delete cascade,
  invite_token_hash text not null unique,
  candidate_session_hash text unique,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  candidate_session_expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint livekit_join_invites_room_check
    check (room_id ~ '^lc-[a-z0-9-]{6,80}$'),
  constraint livekit_join_invites_invite_hash_check
    check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  constraint livekit_join_invites_session_hash_check
    check (
      candidate_session_hash is null
      or candidate_session_hash ~ '^[0-9a-f]{64}$'
    ),
  constraint livekit_join_invites_expiry_check
    check (expires_at > created_at),
  constraint livekit_join_invites_candidate_session_pair_check
    check (
      (candidate_session_hash is null and candidate_session_expires_at is null)
      or
      (candidate_session_hash is not null and candidate_session_expires_at is not null)
    ),
  unique (owner_id, room_id)
);

create index if not exists livekit_join_invites_session_lookup_idx
  on public.livekit_join_invites (
    candidate_session_hash,
    room_id,
    candidate_session_expires_at
  )
  where revoked_at is null and candidate_session_hash is not null;

create index if not exists livekit_join_invites_workspace_owner_idx
  on public.livekit_join_invites (workspace_id, owner_id, created_at desc);

alter table public.livekit_join_invites enable row level security;
revoke all on public.livekit_join_invites from public, anon, authenticated;
grant select, insert, update, delete on public.livekit_join_invites to service_role;

comment on table public.livekit_join_invites is
  'Server-only hashes for single-use in-app call invitations and their short-lived candidate browser sessions.';
comment on column public.livekit_join_invites.invite_token_hash is
  'SHA-256 hash of the single-use secret carried in the URL fragment.';
comment on column public.livekit_join_invites.candidate_session_hash is
  'SHA-256 hash of the opaque HttpOnly candidate browser session created when an invitation is redeemed.';

-- A small server-only counter closes the burst race that a count-then-insert
-- limiter would leave open on serverless instances. The key is already hashed
-- by the app and contains no token, email or participant name.
create table if not exists public.realtime_token_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint realtime_token_rate_limits_key_check
    check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint realtime_token_rate_limits_count_check
    check (request_count >= 0)
);

alter table public.realtime_token_rate_limits enable row level security;
revoke all on public.realtime_token_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.realtime_token_rate_limits to service_role;

create or replace function public.consume_realtime_token_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_window timestamptz;
  current_count integer;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1
     or p_window_seconds < 1
     or p_window_seconds > 86400 then
    raise exception 'invalid realtime token rate-limit input';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds)
      * p_window_seconds
  );

  insert into public.realtime_token_rate_limits (
    key_hash,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_key_hash,
    current_window,
    1,
    now()
  )
  on conflict (key_hash) do update
  set window_started_at = case
        when realtime_token_rate_limits.window_started_at < current_window
          then current_window
        else realtime_token_rate_limits.window_started_at
      end,
      request_count = case
        when realtime_token_rate_limits.window_started_at < current_window
          then 1
        else realtime_token_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

revoke execute on function public.consume_realtime_token_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_realtime_token_rate_limit(text, integer, integer)
  to service_role;

comment on table public.realtime_token_rate_limits is
  'Server-only atomic counters that prevent burst abuse of provider token grants.';
