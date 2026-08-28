-- PostgREST resolves on_conflict=owner_id,fingerprint against a complete
-- unique index. The previous partial index could not be inferred, so every
-- approved task upsert failed with PostgreSQL 42P10. PostgreSQL unique indexes
-- already allow multiple null fingerprint values, making the predicate both
-- unnecessary and incompatible with the API call.

drop index if exists public.tasks_owner_fingerprint_uidx;

create unique index tasks_owner_fingerprint_uidx
  on public.tasks (owner_id, fingerprint);
