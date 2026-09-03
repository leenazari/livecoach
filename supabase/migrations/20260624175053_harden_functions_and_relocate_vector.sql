-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.set_interview_sessions_updated_at() SET search_path = '';
ALTER EXTENSION vector SET SCHEMA extensions;
