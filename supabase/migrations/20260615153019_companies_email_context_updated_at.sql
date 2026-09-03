-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

alter table companies add column if not exists email_context_updated_at timestamptz;
