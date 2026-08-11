-- Keep one organisation's departments and workstreams separate. Company facts can
-- still be shared, while calls, tasks and memory remain inside one workstream.

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);

create unique index if not exists departments_company_name_unique
  on public.departments (company_id, lower(name));

create table if not exists public.workstreams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid,
  name text not null,
  kind text not null default 'relationship'
    check (kind in ('relationship', 'opportunity', 'partnership', 'project', 'support', 'internal')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'archived')),
  purpose text,
  email_context text,
  email_context_updated_at timestamptz,
  email_context_meta jsonb not null default '{}'::jsonb,
  commercial_memory jsonb,
  commercial_memory_updated_at timestamptz,
  next_call jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  constraint workstreams_department_company_fkey
    foreign key (department_id, company_id)
    references public.departments(id, company_id)
    on delete set null (department_id)
);

create unique index if not exists workstreams_company_name_unique
  on public.workstreams (company_id, lower(name));
create index if not exists workstreams_company_status_idx
  on public.workstreams (company_id, status, updated_at desc);

alter table public.contacts
  add column if not exists department_id uuid;
create unique index if not exists contacts_id_company_unique
  on public.contacts (id, company_id);
alter table public.contacts
  drop constraint if exists contacts_department_company_fkey,
  add constraint contacts_department_company_fkey
    foreign key (department_id, company_id)
    references public.departments(id, company_id)
    on delete set null (department_id);

create table if not exists public.workstream_contacts (
  workstream_id uuid not null,
  contact_id uuid not null,
  company_id uuid not null,
  relationship_role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workstream_id, contact_id),
  constraint workstream_contacts_workstream_company_fkey
    foreign key (workstream_id, company_id)
    references public.workstreams(id, company_id)
    on delete cascade,
  constraint workstream_contacts_contact_company_fkey
    foreign key (contact_id, company_id)
    references public.contacts(id, company_id)
    on delete cascade
);
create index if not exists workstream_contacts_contact_idx
  on public.workstream_contacts (contact_id, workstream_id);

alter table public.upcoming_calls add column if not exists workstream_id uuid;
alter table public.interview_sessions add column if not exists workstream_id uuid;
alter table public.interview_summaries add column if not exists workstream_id uuid;
alter table public.tasks add column if not exists workstream_id uuid;
alter table public.opportunities add column if not exists workstream_id uuid;
alter table public.assistant_messages add column if not exists workstream_id uuid;
alter table public.client_context add column if not exists workstream_id uuid;

alter table public.upcoming_calls
  drop constraint if exists upcoming_calls_workstream_company_fkey,
  add constraint upcoming_calls_workstream_company_fkey
    foreign key (workstream_id, company_id) references public.workstreams(id, company_id) on delete set null (workstream_id);
alter table public.interview_sessions
  drop constraint if exists interview_sessions_workstream_company_fkey,
  add constraint interview_sessions_workstream_company_fkey
    foreign key (workstream_id, company_id) references public.workstreams(id, company_id) on delete set null (workstream_id);
alter table public.interview_summaries
  drop constraint if exists interview_summaries_workstream_company_fkey,
  add constraint interview_summaries_workstream_company_fkey
    foreign key (workstream_id, company_id) references public.workstreams(id, company_id) on delete set null (workstream_id);
alter table public.tasks
  drop constraint if exists tasks_workstream_company_fkey,
  add constraint tasks_workstream_company_fkey
    foreign key (workstream_id, company_id) references public.workstreams(id, company_id) on delete set null (workstream_id);
alter table public.opportunities
  drop constraint if exists opportunities_workstream_company_fkey,
  add constraint opportunities_workstream_company_fkey
    foreign key (workstream_id, company_id) references public.workstreams(id, company_id) on delete set null (workstream_id);
alter table public.assistant_messages
  drop constraint if exists assistant_messages_workstream_company_fkey,
  add constraint assistant_messages_workstream_company_fkey
    foreign key (workstream_id, company_id) references public.workstreams(id, company_id) on delete set null (workstream_id);
alter table public.client_context
  drop constraint if exists client_context_workstream_company_fkey,
  add constraint client_context_workstream_company_fkey
    foreign key (workstream_id, company_id) references public.workstreams(id, company_id) on delete set null (workstream_id);

create index if not exists upcoming_calls_workstream_idx on public.upcoming_calls (workstream_id, scheduled_at desc);
create index if not exists interview_sessions_workstream_idx on public.interview_sessions (workstream_id, created_at desc);
create index if not exists interview_summaries_workstream_idx on public.interview_summaries (workstream_id, created_at desc);
create index if not exists tasks_workstream_status_idx on public.tasks (workstream_id, status, created_at desc);
create index if not exists opportunities_workstream_status_idx on public.opportunities (workstream_id, status, updated_at desc);
create index if not exists assistant_messages_workstream_idx on public.assistant_messages (workstream_id, created_at desc);
create index if not exists client_context_workstream_idx on public.client_context (workstream_id, created_at desc);

alter table public.departments enable row level security;
alter table public.workstreams enable row level security;
alter table public.workstream_contacts enable row level security;
revoke all on public.departments from anon, authenticated;
revoke all on public.workstreams from anon, authenticated;
revoke all on public.workstream_contacts from anon, authenticated;
grant all on public.departments to service_role;
grant all on public.workstreams to service_role;
grant all on public.workstream_contacts to service_role;

comment on table public.departments is
  'Departments within one CRM company. Shared company facts live above this boundary.';
comment on table public.workstreams is
  'Independent relationship or project threads. Calls and memory must not cross this boundary.';
comment on column public.upcoming_calls.workstream_id is
  'The exact relationship thread this scheduled call belongs to.';

-- Seed only the two School of Coding threads explicitly confirmed by the user.
insert into public.departments (company_id, name, description)
select c.id, 'Admissions', 'Admissions team and candidate rollout work.'
from public.companies c
where c.id in (
  select company_id from public.contacts
  where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
  group by company_id having count(distinct lower(email)) = 2
)
on conflict do nothing;

insert into public.departments (company_id, name, description)
select c.id, 'University Partnerships', 'University introductions and partnership development.'
from public.companies c
where c.id in (
  select company_id from public.contacts
  where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
  group by company_id having count(distinct lower(email)) = 2
)
on conflict do nothing;

insert into public.workstreams (company_id, department_id, name, kind, purpose)
select c.id, d.id, 'Admissions rollout', 'project',
  'Test and roll out Interviewa with the School of Coding admissions team.'
from public.companies c
join public.departments d on d.company_id = c.id and lower(d.name) = 'admissions'
where c.id in (
  select company_id from public.contacts
  where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
  group by company_id having count(distinct lower(email)) = 2
)
on conflict do nothing;

insert into public.workstreams (company_id, department_id, name, kind, purpose)
select c.id, d.id, 'University introductions', 'partnership',
  'Identify university contacts and agree concrete introductions for Interviewa.'
from public.companies c
join public.departments d on d.company_id = c.id and lower(d.name) = 'university partnerships'
where c.id in (
  select company_id from public.contacts
  where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
  group by company_id having count(distinct lower(email)) = 2
)
on conflict do nothing;

update public.contacts c
set department_id = d.id
from public.departments d
where c.company_id = d.company_id
  and c.company_id in (
    select company_id from public.contacts
    where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
    group by company_id having count(distinct lower(email)) = 2
  )
  and lower(c.email) = 'timothy@schoolofcoding.co.uk'
  and lower(d.name) = 'admissions';

update public.contacts c
set department_id = d.id
from public.departments d
where c.company_id = d.company_id
  and c.company_id in (
    select company_id from public.contacts
    where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
    group by company_id having count(distinct lower(email)) = 2
  )
  and lower(c.email) = 'j.singh@schoolofcoding.co.uk'
  and lower(d.name) = 'university partnerships';

insert into public.workstream_contacts (workstream_id, contact_id, company_id, relationship_role, is_primary)
select w.id, c.id, w.company_id, 'Admissions contact', true
from public.workstreams w
join public.contacts c on c.company_id = w.company_id and lower(c.email) = 'timothy@schoolofcoding.co.uk'
where w.company_id in (
  select company_id from public.contacts
  where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
  group by company_id having count(distinct lower(email)) = 2
)
  and lower(w.name) = 'admissions rollout'
on conflict (workstream_id, contact_id) do update
set relationship_role = excluded.relationship_role, is_primary = excluded.is_primary;

insert into public.workstream_contacts (workstream_id, contact_id, company_id, relationship_role, is_primary)
select w.id, c.id, w.company_id, 'University partnerships contact', true
from public.workstreams w
join public.contacts c on c.company_id = w.company_id and lower(c.email) = 'j.singh@schoolofcoding.co.uk'
where w.company_id in (
  select company_id from public.contacts
  where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
  group by company_id having count(distinct lower(email)) = 2
)
  and lower(w.name) = 'university introductions'
on conflict (workstream_id, contact_id) do update
set relationship_role = excluded.relationship_role, is_primary = excluded.is_primary;

update public.upcoming_calls u
set workstream_id = w.id
from public.workstreams w
where u.company_id = w.company_id
  and w.company_id in (
    select company_id from public.contacts
    where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
    group by company_id having count(distinct lower(email)) = 2
  )
  and lower(w.name) = 'university introductions'
  and u.attendees::text ilike '%j.singh@schoolofcoding.co.uk%';

update public.interview_summaries s
set workstream_id = w.id
from public.workstreams w
where s.company_id = w.company_id
  and w.company_id in (
    select company_id from public.contacts
    where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
    group by company_id having count(distinct lower(email)) = 2
  )
  and lower(w.name) = 'admissions rollout'
  and s.summary::text ilike '%tim%';

update public.interview_sessions s
set workstream_id = w.id
from public.workstreams w
where s.company_id = w.company_id
  and w.company_id in (
    select company_id from public.contacts
    where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
    group by company_id having count(distinct lower(email)) = 2
  )
  and lower(w.name) = 'admissions rollout'
  and exists (
    select 1 from public.interview_summaries sm
    where sm.session_id = s.session_id and sm.workstream_id = w.id
  );

update public.tasks t
set workstream_id = w.id
from public.workstreams w
where t.company_id = w.company_id
  and w.company_id in (
    select company_id from public.contacts
    where lower(email) in ('timothy@schoolofcoding.co.uk', 'j.singh@schoolofcoding.co.uk')
    group by company_id having count(distinct lower(email)) = 2
  )
  and ((lower(w.name) = 'admissions rollout' and t.text ilike '%tim%')
    or (lower(w.name) = 'university introductions' and t.text ilike '%jagdeep%'));
