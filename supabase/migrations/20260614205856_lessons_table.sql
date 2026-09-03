-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  topic text not null default 'general',
  title text,
  content text not null,
  source_url text,
  created_at timestamptz not null default now()
);
create index if not exists lessons_topic_idx on public.lessons(topic);
