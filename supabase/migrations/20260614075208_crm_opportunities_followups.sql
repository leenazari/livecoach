-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

-- LiveCoach CRM - Phase 3: opportunities + follow-up drafts.
-- Additive and non-destructive. RLS enabled, no policies (service-role only,
-- matching the existing CRM tables). owner_id nullable for single-user today.

create table if not exists public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references auth.users(id) on delete set null,
  company_id      uuid references public.companies(id) on delete cascade,
  session_id      text,                                  -- the call it came from
  title           text not null,
  detail          text,
  value           numeric,
  status          text not null default 'open',          -- open | won | lost | dismissed
  surfaced_by_ai  boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists opportunities_company_idx on public.opportunities(company_id);
create index if not exists opportunities_status_idx  on public.opportunities(status);
alter table public.opportunities enable row level security;

create table if not exists public.follow_ups (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references auth.users(id) on delete set null,
  company_id      uuid references public.companies(id) on delete cascade,
  session_id      text,
  draft_subject   text,
  draft_body      text,
  status          text not null default 'draft',         -- draft | sent | dismissed
  created_at      timestamptz not null default now()
);
create index if not exists follow_ups_company_idx on public.follow_ups(company_id);
alter table public.follow_ups enable row level security;
