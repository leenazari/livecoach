-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists google_oauth (
  id text primary key default 'main',
  refresh_token text,
  access_token text,
  expiry timestamptz,
  email text,
  updated_at timestamptz not null default now()
);
