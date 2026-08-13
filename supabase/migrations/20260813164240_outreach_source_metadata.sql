alter table public.outreach_prospects
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

comment on column public.outreach_prospects.source_metadata is
  'Stable source facts from an imported list, such as technology cohort and company switchboard. Kept separate from later web research.';
