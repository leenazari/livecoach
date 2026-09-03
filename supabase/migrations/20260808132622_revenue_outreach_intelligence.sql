-- Revenue forecasting and a controlled, learnable outreach playbook.
-- Additive only: no existing CRM or outreach data is removed.

alter table public.opportunities
  add column if not exists pipeline_stage text not null default 'discovery',
  add column if not exists probability integer not null default 20,
  add column if not exists forecast_category text not null default 'pipeline',
  add column if not exists source text not null default 'crm',
  add column if not exists expected_close_at date,
  add column if not exists outcome_reason text,
  add column if not exists won_at timestamptz,
  add column if not exists lost_at timestamptz;

alter table public.opportunities drop constraint if exists opportunities_pipeline_stage_check;
alter table public.opportunities add constraint opportunities_pipeline_stage_check
  check (pipeline_stage in ('new','discovery','qualified','proposal','negotiation','verbal','won','lost'));
alter table public.opportunities drop constraint if exists opportunities_probability_check;
alter table public.opportunities add constraint opportunities_probability_check
  check (probability between 0 and 100);
alter table public.opportunities drop constraint if exists opportunities_forecast_category_check;
alter table public.opportunities add constraint opportunities_forecast_category_check
  check (forecast_category in ('pipeline','best_case','commit','omitted'));

create index if not exists opportunities_forecast_idx
  on public.opportunities (status, forecast_category, expected_close_at);
create index if not exists opportunities_stage_idx
  on public.opportunities (status, pipeline_stage);

alter table public.outreach_campaigns
  add column if not exists voice jsonb not null default '{"tone":"warm, commercially curious and concise","style":"founder-to-founder, plain English, respectful","rules":["lead with one verified relevance signal","make one useful commercial observation","ask one easy question","never pretend familiarity"],"signature":"Lee"}'::jsonb,
  add column if not exists banned_phrases jsonb not null default '["quick question","hope you are well","reaching out","circle back","touch base","game-changing"]'::jsonb,
  add column if not exists booking_url text,
  add column if not exists booking_cta_mode text not null default 'interested_reply';

alter table public.outreach_campaigns drop constraint if exists outreach_campaigns_booking_cta_mode_check;
alter table public.outreach_campaigns add constraint outreach_campaigns_booking_cta_mode_check
  check (booking_cta_mode in ('interested_reply','final_step','always','never'));

alter table public.outreach_messages
  add column if not exists strategy jsonb not null default '{}'::jsonb,
  add column if not exists quality_score integer,
  add column if not exists message_tags jsonb not null default '{}'::jsonb,
  add column if not exists booking_link_included boolean not null default false;

alter table public.outreach_messages drop constraint if exists outreach_messages_quality_score_check;
alter table public.outreach_messages add constraint outreach_messages_quality_score_check
  check (quality_score is null or quality_score between 0 and 100);

alter table public.outreach_prospects
  add column if not exists crm_company_id uuid references public.companies(id) on delete set null,
  add column if not exists last_reply_text text,
  add column if not exists reply_thread_id text;

alter table public.outreach_enrolments
  add column if not exists booked_at timestamptz;

create table if not exists public.outreach_learnings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.outreach_campaigns(id) on delete cascade,
  dimension text not null check (dimension in ('tone','angle','subject','cta','persona','sequence_step')),
  label text not null,
  insight text not null,
  sent_count integer not null default 0,
  reply_count integer not null default 0,
  positive_reply_count integer not null default 0,
  meeting_count integer not null default 0,
  confidence text not null default 'early' check (confidence in ('early','directional','strong')),
  status text not null default 'observing' check (status in ('observing','promoted','retired')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, dimension, label)
);

create index if not exists outreach_learnings_campaign_idx
  on public.outreach_learnings (campaign_id, status, dimension);

alter table public.outreach_learnings enable row level security;
revoke all on public.outreach_learnings from anon, authenticated;
grant select, insert, update, delete on public.outreach_learnings to service_role;
create policy "Service role manages outreach learnings"
  on public.outreach_learnings for all to service_role using (true) with check (true);

alter table public.outreach_events drop constraint if exists outreach_events_kind_check;
alter table public.outreach_events add constraint outreach_events_kind_check check (kind in (
  'queued','researched','drafted','approved','sent','reply','positive_reply','objection',
  'later','referral','unsubscribe','meeting_booked','booking_link_shared','crm_created',
  'learning_promoted','failed'
));

insert into public.app_config (key, value, note, updated_at) values
  ('revenue_target_gbp', '5000000', 'Annual revenue target used by the revenue command centre', now()),
  ('outreach_default_booking_url', '', 'AI13 scheduling link shared only according to campaign rules', now())
on conflict (key) do nothing;

