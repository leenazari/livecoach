-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE OR REPLACE FUNCTION set_interview_sessions_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_interview_sessions_updated_at ON interview_sessions;
CREATE TRIGGER trg_interview_sessions_updated_at
BEFORE INSERT OR UPDATE ON interview_sessions
FOR EACH ROW EXECUTE FUNCTION set_interview_sessions_updated_at();

UPDATE interview_sessions
SET updated_at = COALESCE(ended_at, created_at, now())
WHERE updated_at IS NULL;
