-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

alter table public.interview_sessions alter column user_id drop not null;
