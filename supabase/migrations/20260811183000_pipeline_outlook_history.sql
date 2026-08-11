-- Add a separate evidence-led win outlook to the existing opportunity workflow.
-- Existing lifecycle stages, probabilities and forecast categories remain the
-- authoritative sales workflow. This migration is additive and does not
-- reinterpret or reprocess historic calls.

alter table public.opportunities
  add column if not exists deal_intent text,
  add column if not exists win_outlook text not null default 'not_assessed',
  add column if not exists win_outlook_confidence smallint,
  add column if not exists win_outlook_reasons jsonb not null default '[]'::jsonb,
  add column if not exists win_outlook_questions jsonb not null default '[]'::jsonb,
  add column if not exists win_outlook_as_of timestamptz,
  add column if not exists win_outlook_source text not null default 'system',
  add column if not exists win_outlook_override boolean not null default false,
  add column if not exists win_outlook_override_at timestamptz,
  add column if not exists engagement_motion text,
  add column if not exists active_contact_method text,
  add column if not exists last_meaningful_activity_at timestamptz,
  add column if not exists last_change_context jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_win_outlook_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities add constraint opportunities_win_outlook_check
      check (win_outlook in ('not_assessed','at_risk','possible','likely','highly_likely','won'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_win_outlook_confidence_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities add constraint opportunities_win_outlook_confidence_check
      check (win_outlook_confidence is null or win_outlook_confidence between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_win_outlook_json_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities add constraint opportunities_win_outlook_json_check
      check (
        jsonb_typeof(win_outlook_reasons) = 'array'
        and jsonb_typeof(win_outlook_questions) = 'array'
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_win_outlook_source_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities add constraint opportunities_win_outlook_source_check
      check (win_outlook_source in ('human','system'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_engagement_motion_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities add constraint opportunities_engagement_motion_check
      check (engagement_motion is null or engagement_motion in (
        'cold_outreach_campaign','personal_relationship_led',
        'existing_customer_expansion','inbound_enquiry','partner_referral'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_active_contact_method_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities add constraint opportunities_active_contact_method_check
      check (active_contact_method is null or active_contact_method in (
        'automated_email','personal_email','phone','video_call','linkedin',
        'event','in_person','other'
      ));
  end if;
end
$$;

create index if not exists opportunities_pipeline_dashboard_idx
  on public.opportunities (status, opportunity_type, pipeline_stage, next_action_due_at);
create index if not exists opportunities_win_outlook_idx
  on public.opportunities (win_outlook, win_outlook_override, win_outlook_as_of desc)
  where status = 'open' and opportunity_type = 'revenue';

-- Append-only audit records. Identifiers are deliberately retained as values
-- rather than cascading foreign keys so deleting another record cannot erase
-- or mutate the commercial history.
create table if not exists public.opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null,
  company_id uuid,
  event_type text not null default 'updated'
    check (event_type in ('created','updated','stage_changed','outlook_changed','status_changed')),
  source_type text not null default 'system'
    check (source_type in ('human','system')),
  source_channel text not null default 'database',
  rationale text,
  changes jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists opportunity_events_opportunity_created_idx
  on public.opportunity_events (opportunity_id, created_at desc);
create index if not exists opportunity_events_company_created_idx
  on public.opportunity_events (company_id, created_at desc);

create or replace function public.log_opportunity_event()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  change_set jsonb := '{}'::jsonb;
  context jsonb := '{}'::jsonb;
  event_kind text := 'updated';
  event_source text := 'system';
  event_channel text := 'database';
  event_rationale text := null;
  event_evidence jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    context := coalesce(new.last_change_context, '{}'::jsonb);
    change_set := jsonb_build_object('created', jsonb_build_object('new', jsonb_build_object(
      'title', new.title,
      'status', new.status,
      'pipeline_stage', new.pipeline_stage,
      'win_outlook', new.win_outlook,
      'value', new.value
    )));
    event_kind := 'created';
  else
    if new.pipeline_stage is distinct from old.pipeline_stage then
      change_set := change_set || jsonb_build_object('pipeline_stage', jsonb_build_object('old', old.pipeline_stage, 'new', new.pipeline_stage));
      event_kind := 'stage_changed';
    end if;
    if new.win_outlook is distinct from old.win_outlook
      or new.win_outlook_confidence is distinct from old.win_outlook_confidence
      or new.win_outlook_reasons is distinct from old.win_outlook_reasons
      or new.win_outlook_override is distinct from old.win_outlook_override then
      change_set := change_set || jsonb_build_object('win_outlook', jsonb_build_object(
        'old', jsonb_build_object('band', old.win_outlook, 'confidence', old.win_outlook_confidence, 'reasons', old.win_outlook_reasons, 'override', old.win_outlook_override),
        'new', jsonb_build_object('band', new.win_outlook, 'confidence', new.win_outlook_confidence, 'reasons', new.win_outlook_reasons, 'override', new.win_outlook_override)
      ));
      event_kind := 'outlook_changed';
    end if;
    if new.status is distinct from old.status then
      change_set := change_set || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
      event_kind := 'status_changed';
    end if;
    if new.value is distinct from old.value then
      change_set := change_set || jsonb_build_object('value', jsonb_build_object('old', old.value, 'new', new.value));
    end if;
    if new.probability is distinct from old.probability then
      change_set := change_set || jsonb_build_object('probability', jsonb_build_object('old', old.probability, 'new', new.probability));
    end if;
    if new.forecast_category is distinct from old.forecast_category then
      change_set := change_set || jsonb_build_object('forecast_category', jsonb_build_object('old', old.forecast_category, 'new', new.forecast_category));
    end if;
    if new.deal_intent is distinct from old.deal_intent then
      change_set := change_set || jsonb_build_object('deal_intent', jsonb_build_object('old', old.deal_intent, 'new', new.deal_intent));
    end if;
    if new.engagement_motion is distinct from old.engagement_motion then
      change_set := change_set || jsonb_build_object('engagement_motion', jsonb_build_object('old', old.engagement_motion, 'new', new.engagement_motion));
    end if;
    if new.active_contact_method is distinct from old.active_contact_method then
      change_set := change_set || jsonb_build_object('active_contact_method', jsonb_build_object('old', old.active_contact_method, 'new', new.active_contact_method));
    end if;
    if new.next_action is distinct from old.next_action
      or new.next_action_due_at is distinct from old.next_action_due_at
      or new.next_action_owner is distinct from old.next_action_owner then
      change_set := change_set || jsonb_build_object('next_action', jsonb_build_object(
        'old', jsonb_build_object('text', old.next_action, 'due_at', old.next_action_due_at, 'owner', old.next_action_owner),
        'new', jsonb_build_object('text', new.next_action, 'due_at', new.next_action_due_at, 'owner', new.next_action_owner)
      ));
    end if;
    if new.expected_close_at is distinct from old.expected_close_at then
      change_set := change_set || jsonb_build_object('expected_close_at', jsonb_build_object('old', old.expected_close_at, 'new', new.expected_close_at));
    end if;
    if new.last_change_context is distinct from old.last_change_context then
      context := coalesce(new.last_change_context, '{}'::jsonb);
    end if;
  end if;

  if change_set = '{}'::jsonb then
    return new;
  end if;

  if context->>'sourceType' in ('human','system') then
    event_source := context->>'sourceType';
  end if;
  event_channel := coalesce(nullif(context->>'sourceChannel', ''), 'database');
  event_rationale := nullif(context->>'rationale', '');
  if jsonb_typeof(context->'evidence') = 'object' then
    event_evidence := context->'evidence';
  end if;

  insert into public.opportunity_events (
    opportunity_id, company_id, event_type, source_type, source_channel,
    rationale, changes, evidence
  ) values (
    new.id, new.company_id, event_kind, event_source, event_channel,
    event_rationale, change_set, event_evidence
  );
  return new;
end;
$$;

drop trigger if exists opportunities_log_event on public.opportunities;
create trigger opportunities_log_event
  after insert or update on public.opportunities
  for each row execute function public.log_opportunity_event();

create or replace function public.prevent_opportunity_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'opportunity events are append-only';
end;
$$;

drop trigger if exists opportunity_events_immutable on public.opportunity_events;
create trigger opportunity_events_immutable
  before update or delete on public.opportunity_events
  for each row execute function public.prevent_opportunity_event_mutation();

alter table public.opportunity_events enable row level security;
revoke all on public.opportunity_events from anon, authenticated;
grant all on public.opportunity_events to service_role;
revoke all on function public.log_opportunity_event() from public, anon, authenticated;
revoke all on function public.prevent_opportunity_event_mutation() from public, anon, authenticated;
grant execute on function public.log_opportunity_event() to service_role;
grant execute on function public.prevent_opportunity_event_mutation() to service_role;

comment on column public.opportunities.win_outlook is
  'Evidence-led win outlook, independent of lifecycle stage and manual probability.';
comment on column public.opportunities.win_outlook_override is
  'True when a human-set outlook must take precedence over system recommendations.';
comment on column public.opportunities.win_outlook_questions is
  'Targeted questions to resolve missing evidence on the next call.';
comment on table public.opportunity_events is
  'Immutable, append-only history of meaningful opportunity changes and their rationale.';
