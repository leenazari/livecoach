-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

-- Per-call cost (GBP) on the scorecard, so the dashboard can total spend over
-- time and the calls list can show cost per call. Additive, nullable.
alter table public.interview_summaries
  add column if not exists cost numeric;
