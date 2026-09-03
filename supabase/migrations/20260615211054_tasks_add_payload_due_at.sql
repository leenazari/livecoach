-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.


alter table tasks add column if not exists payload jsonb;
alter table tasks add column if not exists due_at timestamptz;
