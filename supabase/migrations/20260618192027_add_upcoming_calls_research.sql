-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

ALTER TABLE upcoming_calls ADD COLUMN IF NOT EXISTS research jsonb;
