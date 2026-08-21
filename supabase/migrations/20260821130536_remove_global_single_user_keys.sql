-- Run only after the request-scoped application build is live. The replacement
-- composite unique indexes are created in the preceding additive migration, so
-- these removals change no row and preserve idempotency per account.

alter table public.ai_cache drop constraint if exists ai_cache_pkey;
alter table public.app_config drop constraint if exists app_config_pkey;
alter table public.contact_company_overrides
  drop constraint if exists contact_company_overrides_pkey;

drop index if exists public.tasks_fingerprint_key;
drop index if exists public.upcoming_calls_external_id_uidx;
drop index if exists public.interview_sessions_session_id_key;

alter table public.interview_summaries
  drop constraint if exists interview_summaries_cache_key_key;
alter table public.document_jobs
  drop constraint if exists document_jobs_idempotency_key_key;

alter table public.company_priority
  drop constraint if exists company_priority_pkey;

alter table public.opportunity_signal_receipts
  drop constraint if exists opportunity_signal_receipts_company_id_source_record_type_s_key;

drop index if exists public.external_refs_unique;
