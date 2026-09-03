-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.interview_summaries (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null,
  session_id text,
  candidate text,
  role text,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists interview_summaries_session_idx
  on public.interview_summaries (session_id, created_at desc);

-- Locked down: only the service role (used by the server route) can read/write.
-- RLS on with no policies means anon/auth clients get nothing; service role bypasses RLS.
alter table public.interview_summaries enable row level security;
