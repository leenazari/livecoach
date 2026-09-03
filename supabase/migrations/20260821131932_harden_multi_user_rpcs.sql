-- Existing single-user helpers previously ran with elevated database authority.
-- Run them as the authenticated caller so normal workspace RLS remains the
-- final authority, including when an RPC is called directly instead of through
-- the LiveCoach route.

create unique index if not exists company_priority_owner_company_uidx
  on public.company_priority (owner_id, company_id);

alter function public.replace_company_priority(uuid[]) security invoker;
alter function public.merge_crm_companies(
  uuid,
  uuid,
  timestamp with time zone,
  timestamp with time zone
) security invoker;
alter function public.merge_crm_companies_by_alias(
  uuid,
  uuid,
  timestamp with time zone,
  timestamp with time zone
) security invoker;

revoke all on function public.replace_company_priority(uuid[]) from public, anon;
revoke all on function public.merge_crm_companies(
  uuid,
  uuid,
  timestamp with time zone,
  timestamp with time zone
) from public, anon;
revoke all on function public.merge_crm_companies_by_alias(
  uuid,
  uuid,
  timestamp with time zone,
  timestamp with time zone
) from public, anon;

grant execute on function public.replace_company_priority(uuid[]) to authenticated;
grant execute on function public.merge_crm_companies(
  uuid,
  uuid,
  timestamp with time zone,
  timestamp with time zone
) to authenticated;
grant execute on function public.merge_crm_companies_by_alias(
  uuid,
  uuid,
  timestamp with time zone,
  timestamp with time zone
) to authenticated;
