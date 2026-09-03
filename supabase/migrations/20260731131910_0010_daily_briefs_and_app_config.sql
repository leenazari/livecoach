-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

-- Morning brief log. Every brief that is composed is recorded here whether or
-- not delivery succeeded, so the brain can read back what it told Lee and diff
-- today's thinking against yesterday's. Nothing here is ever deleted.
create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  for_date date not null,
  subject text not null,
  markdown text not null,
  html text,
  to_email text,
  status text not null default 'sent',
  provider_id text,
  error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists daily_briefs_for_date_idx
  on public.daily_briefs (for_date desc, created_at desc);

alter table public.daily_briefs enable row level security;

-- Small key/value config table. Exists so shared secrets live in the database
-- rather than inside a stored scheduled-task prompt.
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  note text,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
