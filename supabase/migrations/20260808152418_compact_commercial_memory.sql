-- A compact, deterministic relationship memory for Brain and call prep.
-- It is refreshed from source records without an AI call, then reused in
-- prompts instead of repeatedly sending the full relationship history.
alter table public.companies
  add column if not exists commercial_memory jsonb,
  add column if not exists commercial_memory_updated_at timestamptz;

comment on column public.companies.commercial_memory is
  'Compact current relationship facts used by Brain and call preparation.';
comment on column public.companies.commercial_memory_updated_at is
  'When the deterministic commercial memory was last refreshed.';
