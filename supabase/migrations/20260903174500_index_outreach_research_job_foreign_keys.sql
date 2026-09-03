create index if not exists outreach_research_jobs_owner_fk_idx
  on public.outreach_research_jobs (owner_id);

create index if not exists outreach_research_jobs_prospect_fk_idx
  on public.outreach_research_jobs (prospect_id);

create index if not exists outreach_research_jobs_enrolment_fk_idx
  on public.outreach_research_jobs (enrolment_id);

create index if not exists outreach_research_jobs_message_fk_idx
  on public.outreach_research_jobs (message_id);

create index if not exists outreach_research_jobs_result_message_fk_idx
  on public.outreach_research_jobs (result_message_id);

comment on index public.outreach_research_jobs_owner_fk_idx is
  'Supports per-salesperson queue ownership and foreign-key maintenance.';

comment on index public.outreach_research_jobs_prospect_fk_idx is
  'Supports prospect-linked queue lookups and foreign-key maintenance.';

comment on index public.outreach_research_jobs_enrolment_fk_idx is
  'Supports enrolment-linked queue lookups and foreign-key maintenance.';

comment on index public.outreach_research_jobs_message_fk_idx is
  'Supports source-message queue lookups and foreign-key maintenance.';

comment on index public.outreach_research_jobs_result_message_fk_idx is
  'Supports completed-message queue lookups and foreign-key maintenance.';
