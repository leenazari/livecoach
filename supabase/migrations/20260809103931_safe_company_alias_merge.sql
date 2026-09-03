-- Explicit saved aliases are strong enough to review as duplicates, but the
-- original merge function intentionally accepts only exact names, domains or
-- contact emails. This narrow wrapper verifies the alias in Postgres, then
-- delegates the all-or-nothing move to the existing hardened merge function.

create or replace function public.merge_crm_companies_by_alias(
  p_keep_id uuid,
  p_merge_id uuid,
  p_expected_keep_updated_at timestamptz,
  p_expected_merge_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep public.companies%rowtype;
  v_merge public.companies%rowtype;
  v_merge_updated_at timestamptz;
  v_result jsonb;
  v_alias_match boolean := false;
begin
  if p_keep_id is null or p_merge_id is null or p_keep_id = p_merge_id then
    raise exception 'Choose two different client records';
  end if;

  perform id
  from public.companies
  where id in (p_keep_id, p_merge_id)
  order by id
  for update;

  select * into v_keep from public.companies where id = p_keep_id;
  select * into v_merge from public.companies where id = p_merge_id;
  if v_keep.id is null or v_merge.id is null then
    raise exception 'One of these client records no longer exists';
  end if;
  if v_keep.updated_at is distinct from p_expected_keep_updated_at
     or v_merge.updated_at is distinct from p_expected_merge_updated_at then
    raise exception 'One of these clients changed after the review. Refresh and review again.';
  end if;

  select exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(v_keep.profile, '{}'::jsonb)->'aliases') = 'array'
          then coalesce(v_keep.profile, '{}'::jsonb)->'aliases'
        else '[]'::jsonb
      end
    ) as a(value)
    where regexp_replace(lower(a.value), '[^a-z0-9]', '', 'g') =
          regexp_replace(lower(v_merge.name), '[^a-z0-9]', '', 'g')
  ) or exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(v_merge.profile, '{}'::jsonb)->'aliases') = 'array'
          then coalesce(v_merge.profile, '{}'::jsonb)->'aliases'
        else '[]'::jsonb
      end
    ) as a(value)
    where regexp_replace(lower(a.value), '[^a-z0-9]', '', 'g') =
          regexp_replace(lower(v_keep.name), '[^a-z0-9]', '', 'g')
  ) into v_alias_match;

  if not v_alias_match then
    raise exception 'These records no longer meet the safe alias duplicate rules';
  end if;

  -- Give the existing merge function an exact-name proof inside this same
  -- transaction. The original name is restored in the redirect audit record.
  update public.companies
  set name = v_keep.name
  where id = p_merge_id
  returning updated_at into v_merge_updated_at;

  v_result := public.merge_crm_companies(
    p_keep_id,
    p_merge_id,
    v_keep.updated_at,
    v_merge_updated_at
  );

  update public.crm_company_redirects
  set source_name = v_merge.name,
      source_snapshot = jsonb_set(source_snapshot, '{name}', to_jsonb(v_merge.name), true)
  where source_id = p_merge_id;

  return jsonb_set(v_result, '{mergedName}', to_jsonb(v_merge.name), true);
end;
$$;

revoke all on function public.merge_crm_companies_by_alias(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.merge_crm_companies_by_alias(uuid, uuid, timestamptz, timestamptz)
  to service_role;
