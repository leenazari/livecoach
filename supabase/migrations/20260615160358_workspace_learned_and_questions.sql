-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

alter table workspace_profile add column if not exists learned text;
alter table workspace_profile add column if not exists open_questions text;
