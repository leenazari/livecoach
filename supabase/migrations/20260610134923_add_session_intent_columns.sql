-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

alter table public.interview_sessions
  add column if not exists session_id text,
  add column if not exists brief text,
  add column if not exists role text,
  add column if not exists call_type text,
  add column if not exists competencies jsonb,
  add column if not exists candidate text,
  add column if not exists source text;

create unique index if not exists interview_sessions_session_id_key
  on public.interview_sessions (session_id);

alter table public.interview_sessions
  alter column started_at set default now();
