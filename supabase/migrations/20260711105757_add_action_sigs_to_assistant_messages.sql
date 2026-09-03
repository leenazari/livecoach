-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

alter table public.assistant_messages add column if not exists action_sigs jsonb;
