-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists usage_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  cost_gbp numeric not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists usage_log_created_idx on usage_log (created_at);
