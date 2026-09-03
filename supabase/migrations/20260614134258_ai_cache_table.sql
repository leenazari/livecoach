-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.ai_cache (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
