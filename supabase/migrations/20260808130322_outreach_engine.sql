alter table public.outreach_prospects
  add column if not exists last_reply_at timestamptz,
  add column if not exists reply_category text,
  add column if not exists reply_summary text;

create table if not exists public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  goal text not null,
  audience text not null,
  offer_angle text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed')),
  approval_mode boolean not null default true,
  daily_limit integer not null default 20 check (daily_limit between 1 and 20),
  sequence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_enrolments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  prospect_id uuid not null references public.outreach_prospects(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'researched', 'drafted', 'approved', 'contacted', 'replied', 'booked', 'completed', 'paused', 'suppressed')),
  current_step integer not null default 1,
  queued_for date,
  next_action_at timestamptz,
  research jsonb,
  research_sources jsonb not null default '[]'::jsonb,
  researched_at timestamptz,
  last_sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, prospect_id)
);

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.outreach_enrolments(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  prospect_id uuid not null references public.outreach_prospects(id) on delete cascade,
  step_number integer not null check (step_number between 1 and 10),
  variant text not null default 'A',
  from_email text not null default 'lee@interviewa.com',
  subject text not null,
  preview_text text,
  body_text text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'failed', 'cancelled')),
  approved_at timestamptz,
  scheduled_at timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrolment_id, step_number)
);

create table if not exists public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.outreach_campaigns(id) on delete cascade,
  prospect_id uuid references public.outreach_prospects(id) on delete cascade,
  message_id uuid references public.outreach_messages(id) on delete cascade,
  kind text not null check (kind in ('queued', 'researched', 'drafted', 'approved', 'sent', 'reply', 'positive_reply', 'objection', 'later', 'referral', 'unsubscribe', 'meeting_booked', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_suppressions (
  target text primary key,
  kind text not null check (kind in ('email', 'domain')),
  reason text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists outreach_enrolments_queue_idx on public.outreach_enrolments (queued_for, status, next_action_at);
create index if not exists outreach_enrolments_prospect_idx on public.outreach_enrolments (prospect_id);
create index if not exists outreach_messages_send_idx on public.outreach_messages (status, sent_at);
create index if not exists outreach_messages_campaign_idx on public.outreach_messages (campaign_id);
create index if not exists outreach_messages_prospect_idx on public.outreach_messages (prospect_id);
create index if not exists outreach_events_campaign_created_idx on public.outreach_events (campaign_id, created_at desc);
create index if not exists outreach_events_prospect_idx on public.outreach_events (prospect_id);
create index if not exists outreach_events_message_idx on public.outreach_events (message_id);

alter table public.outreach_campaigns enable row level security;
alter table public.outreach_enrolments enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.outreach_events enable row level security;
alter table public.outreach_suppressions enable row level security;

revoke all on public.outreach_campaigns, public.outreach_enrolments, public.outreach_messages, public.outreach_events, public.outreach_suppressions from anon, authenticated;
grant select, insert, update, delete on public.outreach_campaigns, public.outreach_enrolments, public.outreach_messages, public.outreach_events, public.outreach_suppressions to service_role;

create policy "Service role manages outreach campaigns" on public.outreach_campaigns for all to service_role using (true) with check (true);
create policy "Service role manages outreach enrolments" on public.outreach_enrolments for all to service_role using (true) with check (true);
create policy "Service role manages outreach messages" on public.outreach_messages for all to service_role using (true) with check (true);
create policy "Service role manages outreach events" on public.outreach_events for all to service_role using (true) with check (true);
create policy "Service role manages outreach suppressions" on public.outreach_suppressions for all to service_role using (true) with check (true);

insert into public.outreach_campaigns (name, goal, audience, offer_angle, status, sequence)
values (
  'Interviewa recruitment leaders',
  'Book a focused Interviewa demonstration',
  'Founders and senior leaders at UK recruitment and staffing businesses',
  'Help their candidates and consultants practise interviews and improve performance with realistic AI coaching',
  'active',
  '[{"step":1,"delayDays":0,"purpose":"Relevant opening and one easy question"},{"step":2,"delayDays":3,"purpose":"Show a second use case based on their business"},{"step":3,"delayDays":7,"purpose":"Short close-the-loop message"}]'::jsonb
)
on conflict (name) do nothing;

insert into public.app_config (key, value, note, updated_at)
values ('outreach_from_email', 'lee@interviewa.com', 'Mandatory visible sender for all prospect outreach', now())
on conflict (key) do update set value = excluded.value, note = excluded.note, updated_at = now();
