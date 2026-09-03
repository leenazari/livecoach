-- Replacing a manual opportunity order is one logical save. Keep the delete
-- and insert in a single short transaction so a failed insert can never erase
-- the last confirmed order.

create or replace function public.replace_company_priority(p_order uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid[] := coalesce(p_order, array[]::uuid[]);
  v_saved integer := 0;
begin
  -- Serialise this tiny whole-list write. Without it, two browser tabs could
  -- interleave replacement attempts and produce a mixed or rejected order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('livecoach_company_priority', 0)
  );

  if pg_catalog.cardinality(v_order) <> (
    select count(distinct company_id)
    from pg_catalog.unnest(v_order) as company_id
  ) then
    raise exception 'The opportunity order contains duplicate clients';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(v_order) as requested(company_id)
    left join public.companies on companies.id = requested.company_id
    where companies.id is null
  ) then
    raise exception 'The opportunity order contains a client that no longer exists';
  end if;

  delete from public.company_priority;

  insert into public.company_priority(company_id, position, updated_at)
  select company_id, ordinality - 1, pg_catalog.now()
  from pg_catalog.unnest(v_order) with ordinality as requested(company_id, ordinality);

  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

revoke all on function public.replace_company_priority(uuid[])
  from public, anon, authenticated;
grant execute on function public.replace_company_priority(uuid[])
  to service_role;
