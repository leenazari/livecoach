-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS upcoming_id uuid;
