-- A quick call note is an immutable source event. Its compact interpretation
-- may update the canonical opportunity once, but later automation must not
-- overwrite a salesperson's explicit stage or next-action correction.

alter table public.opportunities
  add column if not exists pipeline_stage_override boolean not null default false,
  add column if not exists pipeline_stage_override_at timestamptz,
  add column if not exists next_action_override boolean not null default false,
  add column if not exists next_action_override_at timestamptz;

alter table public.opportunity_events
  drop constraint if exists opportunity_events_event_type_check;

alter table public.opportunity_events
  add constraint opportunity_events_event_type_check
  check (event_type in (
    'created', 'updated', 'stage_changed', 'outlook_changed',
    'status_changed', 'call_logged', 'call_interpreted'
  ));

-- A browser retry cannot create a second call log or pay to interpret the
-- same note twice. The event itself remains immutable.
create unique index if not exists opportunity_events_quick_call_request_uidx
  on public.opportunity_events (
    opportunity_id,
    event_type,
    ((evidence ->> 'requestId'))
  )
  where event_type in ('call_logged', 'call_interpreted')
    and evidence ? 'requestId';

-- Preserve human changes made before these explicit protection fields were
-- introduced. The append-only history is the evidence, so no old transcript
-- or email needs to be reprocessed.
update public.opportunities opportunity
set
  pipeline_stage_override = true,
  pipeline_stage_override_at = history.changed_at
from (
  select opportunity_id, max(created_at) as changed_at
  from public.opportunity_events
  where source_type = 'human' and changes ? 'pipeline_stage'
  group by opportunity_id
) history
where opportunity.id = history.opportunity_id
  and opportunity.pipeline_stage_override = false;

update public.opportunities opportunity
set
  next_action_override = true,
  next_action_override_at = history.changed_at
from (
  select opportunity_id, max(created_at) as changed_at
  from public.opportunity_events
  where source_type = 'human' and changes ? 'next_action'
  group by opportunity_id
) history
where opportunity.id = history.opportunity_id
  and opportunity.next_action_override = false;

comment on column public.opportunities.pipeline_stage_override is
  'True when a human lifecycle-stage correction must take precedence over automatic call-note suggestions.';
comment on column public.opportunities.next_action_override is
  'True when a human next-action correction must take precedence over automatic call-note suggestions.';
