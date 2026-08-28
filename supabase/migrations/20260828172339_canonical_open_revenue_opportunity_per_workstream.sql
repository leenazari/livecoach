-- Keep one canonical active revenue opportunity for each company relationship
-- scope. Separate departments remain valid when they use distinct workstreams.
-- Legacy duplicates are archived, never deleted, so the immutable history and
-- evidence remain available.

with ranked as (
  select
    id,
    first_value(id) over scope_order as canonical_id,
    row_number() over scope_order as position
  from public.opportunities
  where company_id is not null
    and status = 'open'
    and opportunity_type = 'revenue'
  window scope_order as (
    partition by company_id, workstream_id
    order by
      (surfaced_by_ai is not true) desc,
      (
        coalesce(pipeline_stage_override, false)
        or coalesce(win_outlook_override, false)
        or coalesce(next_action_override, false)
      ) desc,
      updated_at desc nulls last,
      created_at desc,
      id
  )
)
update public.opportunities opportunity
set status = 'dismissed',
    forecast_category = 'omitted',
    updated_at = now(),
    last_change_context = jsonb_build_object(
      'nonce', gen_random_uuid()::text,
      'sourceType', 'system',
      'sourceChannel', 'canonical_opportunity_migration',
      'rationale', 'Archived a legacy duplicate active revenue opportunity while preserving its history',
      'evidence', jsonb_build_object(
        'canonicalOpportunityId', ranked.canonical_id,
        'duplicateOpportunityId', ranked.id
      )
    )
from ranked
where opportunity.id = ranked.id
  and ranked.position > 1;

create unique index if not exists opportunities_one_open_revenue_per_scope_idx
  on public.opportunities (
    company_id,
    coalesce(
      workstream_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  where company_id is not null
    and status = 'open'
    and opportunity_type = 'revenue';

comment on index public.opportunities_one_open_revenue_per_scope_idx is
  'One active revenue buying decision per company or explicit workstream. Product use cases belong in evidence, not duplicate deal rows.';
