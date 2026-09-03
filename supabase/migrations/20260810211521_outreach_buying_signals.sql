create table if not exists public.outreach_signals (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'linkedin'
    check (source_type in ('linkedin', 'email', 'news', 'manual')),
  source_url text,
  source_text text not null,
  prospect_id uuid references public.outreach_prospects(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  author_name text,
  author_role text,
  company_name text,
  signal_type text not null default 'other'
    check (signal_type in ('hiring', 'growth', 'pain', 'leadership', 'funding', 'partnership', 'product', 'engagement', 'other')),
  summary text not null,
  relevance_reason text,
  opportunity_hypothesis text,
  evidence jsonb not null default '[]'::jsonb,
  recommended_action text not null default 'ignore'
    check (recommended_action in ('comment', 'message', 'prepare_outreach', 'follow_up', 'ignore')),
  draft_text text,
  priority text not null default 'low'
    check (priority in ('high', 'medium', 'low')),
  confidence text not null default 'low'
    check (confidence in ('high', 'medium', 'low')),
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'approved', 'acted', 'dismissed')),
  ai_processed_at timestamptz,
  approved_at timestamptz,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists outreach_signals_source_url_unique
  on public.outreach_signals (lower(source_url))
  where nullif(trim(source_url), '') is not null;
create index if not exists outreach_signals_status_priority_created_idx
  on public.outreach_signals (status, priority, created_at desc);
create index if not exists outreach_signals_prospect_idx
  on public.outreach_signals (prospect_id, created_at desc);
create index if not exists outreach_signals_company_idx
  on public.outreach_signals (company_id, created_at desc);

comment on table public.outreach_signals is
  'Approval gated buying signals. Full evidence is stored once while compact analysis is reused by the Brain.';

alter table public.outreach_signals enable row level security;
revoke all on table public.outreach_signals from anon, authenticated;
grant select, insert, update, delete on table public.outreach_signals to service_role;

create policy "Service role manages outreach signals"
  on public.outreach_signals
  for all
  to service_role
  using (true)
  with check (true);
