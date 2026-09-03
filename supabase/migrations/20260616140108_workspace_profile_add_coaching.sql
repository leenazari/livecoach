-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

alter table workspace_profile add column if not exists coaching text;
