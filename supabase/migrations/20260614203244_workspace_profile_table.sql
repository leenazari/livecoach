-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.workspace_profile (
  id text primary key default 'main',
  knowledge text not null default '',
  updated_at timestamptz not null default now()
);
