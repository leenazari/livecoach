-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.upcoming_calls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  company_id uuid references public.companies(id) on delete set null,
  title text,
  scheduled_at timestamptz,
  meeting_url text,
  intent text,
  prepped boolean not null default false,
  prep jsonb,
  source text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now()
);
create index if not exists upcoming_calls_scheduled_idx on public.upcoming_calls(scheduled_at);
