-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

-- Tracks Recall bots per session so a bot can be stopped by session_id even
-- after the browser tab that dispatched it is gone. Service-role-only (no
-- policies), consistent with the other tables.
create table if not exists public.meet_bots (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  bot_id      text not null,
  status      text not null default 'active',   -- 'active' | 'left'
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create index if not exists meet_bots_session_idx
  on public.meet_bots (session_id, status);
create unique index if not exists meet_bots_bot_id_idx
  on public.meet_bots (bot_id);

alter table public.meet_bots enable row level security;
