create table if not exists public.outreach_prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  email text not null,
  first_name text,
  last_name text,
  job_title text,
  company_name text not null,
  company_domain text,
  website text,
  employee_range text,
  industry text,
  street_address text,
  city text,
  state text,
  postal_code text,
  country text,
  phone text,
  person_linkedin_url text,
  company_linkedin_url text,
  public_profile text,
  company_house_url text,
  company_incorporated_date text,
  priority text not null default 'low' check (priority in ('high', 'medium', 'low')),
  priority_score integer not null default 0 check (priority_score between 0 and 100),
  priority_reason text,
  status text not null default 'imported' check (status in ('imported', 'queued', 'researching', 'ready', 'contacted', 'replied', 'qualified', 'not_interested', 'suppressed')),
  research jsonb,
  last_researched_at timestamptz,
  last_contacted_at timestamptz,
  next_action_at timestamptz,
  suppression_reason text,
  source_file text,
  source_sheet text,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists outreach_prospects_email_unique
  on public.outreach_prospects (lower(email));
create index if not exists outreach_prospects_priority_status_idx
  on public.outreach_prospects (priority, status);
create index if not exists outreach_prospects_company_domain_idx
  on public.outreach_prospects (company_domain);

comment on table public.outreach_prospects is
  'Cold outreach contacts kept separate from active CRM clients. Research is populated only when a prospect is selected for outreach.';

alter table public.outreach_prospects enable row level security;
revoke all on table public.outreach_prospects from anon, authenticated;
grant select, insert, update, delete on table public.outreach_prospects to service_role;
