-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create unique index if not exists upcoming_calls_external_id_uidx
  on upcoming_calls (external_id)
  where external_id is not null;
