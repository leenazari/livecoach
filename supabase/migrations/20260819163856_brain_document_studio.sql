-- Persist every Brain-requested document before generation begins. The CRM and
-- the Brain use this one canonical record for status, cost, source links and
-- the final private file. Historical jobs are retained as document versions.

create table if not exists public.document_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  task_id uuid,
  supersedes_job_id uuid,
  idempotency_key text not null unique,
  document_type text not null default 'other'
    check (document_type in ('plan','agreement','handbook','proposal','report','brief','other')),
  title text not null,
  instructions text not null,
  status text not null default 'queued'
    check (status in ('queued','processing','quality_check','complete','failed')),
  progress smallint not null default 0
    check (progress between 0 and 100),
  stage_label text not null default 'Queued',
  source_refs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_refs) = 'array'),
  source_fingerprint text,
  result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result) = 'object'),
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_gbp numeric(12,6),
  file_bucket text,
  file_path text,
  file_name text,
  mime_type text,
  error text,
  attempts smallint not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_jobs_status_created_idx
  on public.document_jobs (status, created_at desc);
create index if not exists document_jobs_company_created_idx
  on public.document_jobs (company_id, created_at desc)
  where company_id is not null;
create index if not exists document_jobs_task_idx
  on public.document_jobs (task_id)
  where task_id is not null;

alter table public.document_jobs enable row level security;
revoke all on table public.document_jobs from anon, authenticated, service_role;
grant select, insert, update on table public.document_jobs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-documents',
  'crm-documents',
  false,
  10485760,
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.document_jobs is
  'Persistent, nonblocking Brain document generations and their immutable private files.';
comment on column public.document_jobs.source_refs is
  'Pointers to canonical CRM records used for this generation. Raw transcripts are never copied here.';
