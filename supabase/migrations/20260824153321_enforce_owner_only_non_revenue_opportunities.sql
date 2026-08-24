-- Internal work, strategic ideas and investment conversations are never team
-- pipeline records. Keep every existing row, but make the privacy boundary a
-- database invariant so a future UI or service-role bug cannot expose them to
-- another salesperson.

update public.opportunities
set visibility = 'private',
    assigned_to_user_id = owner_id,
    forecast_category = 'omitted',
    updated_at = now(),
    last_change_context = jsonb_build_object(
      'nonce', gen_random_uuid()::text,
      'sourceType', 'system',
      'sourceChannel', 'privacy_invariant',
      'rationale', 'Non-revenue work is owner only',
      'evidence', '{}'::jsonb
    )
where opportunity_type <> 'revenue'
  and (
    visibility is distinct from 'private'
    or assigned_to_user_id is distinct from owner_id
    or forecast_category is distinct from 'omitted'
  );

create or replace function public.enforce_non_revenue_opportunity_privacy()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(new.opportunity_type, 'revenue') <> 'revenue' then
    new.visibility := 'private';
    new.assigned_to_user_id := new.owner_id;
    new.forecast_category := 'omitted';
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_enforce_non_revenue_privacy
  on public.opportunities;
create trigger opportunities_enforce_non_revenue_privacy
  before insert or update of opportunity_type, owner_id, visibility,
    assigned_to_user_id, forecast_category
  on public.opportunities
  for each row execute function public.enforce_non_revenue_opportunity_privacy();

revoke execute on function public.enforce_non_revenue_opportunity_privacy()
  from public, anon, authenticated;

alter table public.opportunities
  drop constraint if exists opportunities_non_revenue_owner_only_check,
  add constraint opportunities_non_revenue_owner_only_check
    check (
      opportunity_type = 'revenue'
      or (
        visibility = 'private'
        and assigned_to_user_id = owner_id
        and forecast_category = 'omitted'
      )
    ) not valid;

alter table public.opportunities
  validate constraint opportunities_non_revenue_owner_only_check;

comment on constraint opportunities_non_revenue_owner_only_check
  on public.opportunities is
  'Investment, internal and strategic work is visible only to its privacy owner and the workspace owner.';
