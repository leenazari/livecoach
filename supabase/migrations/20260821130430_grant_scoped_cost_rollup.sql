-- The cost rollup is security-invoker and therefore remains subject to the
-- caller's RLS visibility. Allow signed-in workspace members to execute it so
-- the request-scoped API no longer needs service-role authority.

revoke all on function public.crm_dashboard_cost_rollup() from public, anon;
grant execute on function public.crm_dashboard_cost_rollup() to authenticated;
