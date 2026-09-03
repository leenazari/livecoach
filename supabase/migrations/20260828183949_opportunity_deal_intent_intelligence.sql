-- Give the canonical deal intent its own provenance and human-override guard.
-- New material activity can refresh the intent once at ingestion time. Page
-- loads never regenerate it and a person's wording always wins.

alter table public.opportunities
  add column if not exists deal_intent_as_of timestamptz,
  add column if not exists deal_intent_source text not null default 'system',
  add column if not exists deal_intent_override boolean not null default false,
  add column if not exists deal_intent_override_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunities_deal_intent_source_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities
      add constraint opportunities_deal_intent_source_check
      check (deal_intent_source in ('human', 'system'));
  end if;
end
$$;

comment on column public.opportunities.deal_intent is
  'Concise forward-looking commercial objective and outcome required from the next conversation.';
comment on column public.opportunities.deal_intent_as_of is
  'When the canonical deal intent was last derived or confirmed.';
comment on column public.opportunities.deal_intent_source is
  'Whether the current deal intent was written by a human or derived from stored evidence.';
comment on column public.opportunities.deal_intent_override is
  'True when human wording is locked against automatic evidence updates.';

-- Retain the existing scoped immutable history behaviour while adding intent
-- provenance to the event. This replaces only the trigger function, not data.
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
      'deal_intent', new.deal_intent,
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
    if new.deal_intent is distinct from old.deal_intent
      or new.deal_intent_source is distinct from old.deal_intent_source
      or new.deal_intent_override is distinct from old.deal_intent_override then
      change_set := change_set || jsonb_build_object('deal_intent', jsonb_build_object(
        'old', jsonb_build_object(
          'text', old.deal_intent,
          'source', old.deal_intent_source,
          'as_of', old.deal_intent_as_of,
          'override', old.deal_intent_override
        ),
        'new', jsonb_build_object(
          'text', new.deal_intent,
          'source', new.deal_intent_source,
          'as_of', new.deal_intent_as_of,
          'override', new.deal_intent_override
        )
      ));
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

  if context->>'sourceType' in ('human', 'system') then
    event_source := context->>'sourceType';
  end if;
  event_channel := coalesce(nullif(context->>'sourceChannel', ''), 'database');
  event_rationale := nullif(context->>'rationale', '');
  if jsonb_typeof(context->'evidence') = 'object' then
    event_evidence := context->'evidence';
  end if;

  insert into public.opportunity_events (
    opportunity_id, company_id, event_type, source_type, source_channel,
    rationale, changes, evidence, workspace_id, owner_id, visibility
  ) values (
    new.id, new.company_id, event_kind, event_source, event_channel,
    event_rationale, change_set, event_evidence,
    new.workspace_id, new.owner_id, coalesce(new.visibility, 'private')
  );
  return new;
end;
$$;

revoke all on function public.log_opportunity_event() from public, anon, authenticated;
grant execute on function public.log_opportunity_event() to service_role;
