-- Give every LiveCoach account its own notetaker identity and secure the
-- browser-to-Railway transcript stream with short-lived, session-bound tokens.
-- Existing calls and transcripts remain untouched.

alter table public.profiles
  add column if not exists transcriber_name text,
  add column if not exists transcriber_aliases text[] not null default '{}'::text[],
  add column if not exists transcriber_language text not null default 'en';

update public.profiles
set transcriber_name = case
      when nullif(trim(display_name), '') is null then 'LiveCoach Notetaker'
      when lower(right(split_part(trim(display_name), ' ', 1), 1)) = 's'
        then split_part(trim(display_name), ' ', 1) || ''' LiveCoach Notetaker'
      else split_part(trim(display_name), ' ', 1) || '''s LiveCoach Notetaker'
    end,
    transcriber_aliases = case
      when nullif(trim(display_name), '') is null then '{}'::text[]
      else array[trim(display_name)]
    end,
    updated_at = now()
where transcriber_name is null;

alter table public.profiles
  drop constraint if exists profiles_transcriber_name_check,
  add constraint profiles_transcriber_name_check
    check (
      transcriber_name is null
      or length(trim(transcriber_name)) between 1 and 80
    ) not valid,
  drop constraint if exists profiles_transcriber_aliases_check,
  add constraint profiles_transcriber_aliases_check
    check (cardinality(transcriber_aliases) <= 12) not valid,
  drop constraint if exists profiles_transcriber_language_check,
  add constraint profiles_transcriber_language_check
    check (transcriber_language ~ '^[a-z]{2}(-[A-Z]{2})?$') not valid;

alter table public.profiles
  validate constraint profiles_transcriber_name_check,
  validate constraint profiles_transcriber_aliases_check,
  validate constraint profiles_transcriber_language_check;

alter table public.meet_bots
  add column if not exists bot_name text,
  add column if not exists provider text not null default 'recall',
  add column if not exists webhook_token_hash text,
  add column if not exists webhook_token_expires_at timestamptz;

alter table public.meet_bots
  drop constraint if exists meet_bots_webhook_token_hash_check,
  add constraint meet_bots_webhook_token_hash_check
    check (
      webhook_token_hash is null
      or webhook_token_hash ~ '^[0-9a-f]{64}$'
    ) not valid;

alter table public.meet_bots
  validate constraint meet_bots_webhook_token_hash_check;

alter table public.meet_utterances
  add column if not exists bot_id text,
  add column if not exists provider_event_id text;

create unique index if not exists meet_bots_owner_session_active_uidx
  on public.meet_bots (owner_id, session_id)
  where status = 'active';

create unique index if not exists meet_bots_webhook_token_hash_uidx
  on public.meet_bots (webhook_token_hash)
  where webhook_token_hash is not null;

create index if not exists meet_utterances_owner_session_created_idx
  on public.meet_utterances (owner_id, session_id, created_at);

create unique index if not exists meet_utterances_provider_event_id_uidx
  on public.meet_utterances (provider_event_id);

create table if not exists public.meet_stream_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meet_stream_tokens_session_check
    check (session_id ~ '^lc-[a-z0-9-]{6,80}$'),
  constraint meet_stream_tokens_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint meet_stream_tokens_expiry_check
    check (expires_at > created_at),
  unique (owner_id, session_id)
);

create index if not exists meet_stream_tokens_lookup_idx
  on public.meet_stream_tokens (token_hash, session_id, expires_at)
  where revoked_at is null;

alter table public.meet_stream_tokens enable row level security;
revoke all on public.meet_stream_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.meet_stream_tokens to service_role;

comment on table public.meet_stream_tokens is
  'Server-only hashes of short-lived tokens that bind one browser transcript stream to one user and call session.';
comment on column public.meet_bots.bot_name is
  'The owner-specific notetaker name presented inside the meeting.';
comment on column public.meet_bots.webhook_token_hash is
  'SHA-256 hash of a short-lived per-bot secret used to authenticate Recall real-time transcript delivery.';
comment on column public.meet_utterances.bot_id is
  'Recall bot that supplied the utterance. The worker resolves its owner before persisting.';

-- Legacy service-role writes used to fall back to the first workspace owner.
-- That was safe only while one account existed. Once multiple accounts are
-- active, an unscoped write must fail instead of silently landing in Lee's data.
create or replace function public.apply_livecoach_record_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  default_visibility text := coalesce(nullif(tg_argv[0], ''), 'private');
  fallback_workspace_id uuid;
  fallback_owner_id uuid;
  active_member_count integer;
begin
  if new.owner_id is null then
    new.owner_id := (select auth.uid());
  end if;

  if new.workspace_id is null and new.owner_id is not null then
    select wm.workspace_id into new.workspace_id
    from public.workspace_members wm
    where wm.user_id = new.owner_id and wm.status = 'active'
    order by wm.created_at asc
    limit 1;
  end if;

  if new.workspace_id is null or new.owner_id is null then
    select count(*) into active_member_count
    from public.workspace_members wm
    where wm.status = 'active';

    if active_member_count = 1 then
      select wm.workspace_id, wm.user_id
        into fallback_workspace_id, fallback_owner_id
      from public.workspace_members wm
      where wm.status = 'active'
      order by wm.created_at asc
      limit 1;

      new.workspace_id := coalesce(new.workspace_id, fallback_workspace_id);
      new.owner_id := coalesce(new.owner_id, fallback_owner_id);
    else
      raise exception
        'explicit record owner is required when % active workspace members exist',
        active_member_count;
    end if;
  end if;

  new.visibility := coalesce(new.visibility, default_visibility);

  if new.workspace_id is null or new.owner_id is null then
    raise exception 'record scope could not be resolved';
  end if;

  return new;
end;
$$;

revoke execute on function public.apply_livecoach_record_scope()
  from public, anon, authenticated;
grant execute on function public.apply_livecoach_record_scope()
  to service_role;
