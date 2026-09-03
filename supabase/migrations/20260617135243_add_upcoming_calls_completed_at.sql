-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

alter table public.upcoming_calls add column if not exists completed_at timestamptz;
