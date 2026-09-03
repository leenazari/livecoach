-- The production function pre-dated its recorded permission migration. Keep
-- the definition here so a clean branch can replay the recorded history
-- without depending on untracked production state.
create or replace function public.crm_dashboard_cost_rollup()
returns table (
  feature text,
  source text,
  week numeric,
  month numeric,
  total numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      pg_catalog.timezone(
        'Europe/London',
        pg_catalog.date_trunc(
          'week',
          pg_catalog.timezone('Europe/London', pg_catalog.now())
        )
      ) as week_start,
      pg_catalog.timezone(
        'Europe/London',
        pg_catalog.date_trunc(
          'month',
          pg_catalog.timezone('Europe/London', pg_catalog.now())
        )
      ) as month_start
  ),
  cost_rows as (
    select
      'Live calls & cues'::text as feature,
      'calls'::text as source,
      coalesce(summary.cost::numeric, 0::numeric) as amount,
      summary.created_at
    from public.interview_summaries as summary
    where summary.cost is not null

    union all

    select
      case
        when pg_catalog.lower(log.kind) like 'automation%' then 'Automation'
        when pg_catalog.lower(log.kind) ~ '(intent|research|battlecard|prep)'
          then 'Preparation & intent'
        when pg_catalog.lower(log.kind) ~ '(summary|profile|commitment|extract|digest|cross-link|activity)'
          then 'Summaries & CRM sync'
        when pg_catalog.lower(log.kind) ~ '(coach|brain|lesson|assistant|correct)'
          then 'Brain & coaching'
        when pg_catalog.lower(log.kind) ~ '(opp|day-read|pipeline)'
          then 'CRM organisation'
        else 'Other AI'
      end::text as feature,
      case
        when pg_catalog.lower(log.kind) like 'automation%' then 'automation'
        else 'ai'
      end::text as source,
      coalesce(log.cost_gbp::numeric, 0::numeric) as amount,
      log.created_at
    from public.usage_log as log
  )
  select
    rows.feature,
    rows.source,
    coalesce(
      pg_catalog.sum(rows.amount) filter (
        where rows.created_at >= bounds.week_start
      ),
      0::numeric
    ) as week,
    coalesce(
      pg_catalog.sum(rows.amount) filter (
        where rows.created_at >= bounds.month_start
      ),
      0::numeric
    ) as month,
    coalesce(pg_catalog.sum(rows.amount), 0::numeric) as total
  from cost_rows as rows
  cross join bounds
  group by rows.feature, rows.source
  order by week desc, rows.feature;
$$;

-- The cost rollup is security-invoker and therefore remains subject to the
-- caller's RLS visibility. Allow signed-in workspace members to execute it so
-- the request-scoped API no longer needs service-role authority.

revoke all on function public.crm_dashboard_cost_rollup() from public, anon;
grant execute on function public.crm_dashboard_cost_rollup() to authenticated;
