-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  company_id uuid references public.companies(id) on delete cascade,
  text text not null,
  kind text not null default 'next_step',
  link_kind text,
  source text,
  source_ref text,
  fingerprint text not null,
  status text not null default 'open',
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists tasks_fingerprint_key on public.tasks(fingerprint);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_company_idx on public.tasks(company_id);
