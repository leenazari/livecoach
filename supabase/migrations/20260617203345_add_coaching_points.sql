-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.coaching_points (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  company_id uuid,
  quote text,
  better text,
  why text,
  vote int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists coaching_points_session_idx on public.coaching_points (session_id);
