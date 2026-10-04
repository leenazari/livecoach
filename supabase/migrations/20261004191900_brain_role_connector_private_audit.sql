-- Add connector names without removing old names or relaxing existing RLS.
alter table public.mcp_action_receipts
  drop constraint mcp_action_receipts_tool_name_check,
  add constraint mcp_action_receipts_tool_name_check check (tool_name in (
    'find_my_lead','list_my_leads','add_lead','add_lead_context','create_my_follow_up','list_my_tasks',
    'list_my_work','get_my_work_record','create_my_task','update_my_task','save_my_campaign',
    'save_my_marketing_lead','append_my_note','search_my_email','read_my_email',
    'ask_my_brain','execute_my_brain_action','get_my_brain_execution','undo_my_brain_action'
  )),
  drop constraint mcp_action_receipts_target_table_check,
  add constraint mcp_action_receipts_target_table_check check (target_table is null or target_table in (
    'outreach_prospects','tasks','marketing_campaigns','marketing_leads','companies','contacts','brain_action_executions'
  ));

-- Raw personal Brain history and results never become team-readable just
-- because a record was labelled team. Add restrictive policies so existing
-- permissive policies cannot reopen the boundary. No stored rows are deleted.
create policy "Personal Brain conversation boundary" on public.assistant_messages
  as restrictive for all to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = assistant_messages.workspace_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ))
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = assistant_messages.workspace_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ));
create policy "Personal Brain routine response boundary" on public.brain_routine_runs
  as restrictive for all to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = brain_routine_runs.workspace_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ))
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.workspace_members m where m.workspace_id = brain_routine_runs.workspace_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
  ));
create policy "Personal Brain action result boundary" on public.brain_action_executions
  as restrictive for select to authenticated using (actor_user_id = (select auth.uid()));
create policy "Personal Brain connector result boundary" on public.mcp_action_receipts
  as restrictive for select to authenticated using (
    tool_name not in ('ask_my_brain','execute_my_brain_action','get_my_brain_execution','undo_my_brain_action')
    or actor_user_id = (select auth.uid())
  );

-- Separate immutable audit copies. They expire at 30 days and never replace
-- or erase a user's ongoing private Brain relationship/history.
create table public.brain_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  actor_role text not null check (actor_role in ('owner','manager','sales')),
  source text not null check (source in ('livecoach','chatgpt')),
  event_type text not null check (event_type in ('conversation_requested','conversation_completed','conversation_failed',
    'action_requested','action_completed','action_failed','action_denied','action_undone','connector_failed')),
  correlation_id uuid not null,
  status text not null check (status in ('started','completed','failed','denied')),
  request_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(request_payload) = 'object'),
  response_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(response_payload) = 'object'),
  error text,
  truncations jsonb not null default '[]'::jsonb check (jsonb_typeof(truncations) = 'array'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '720 hours',
  check (expires_at = created_at + interval '720 hours')
);
create index brain_audit_logs_workspace_recent_idx on public.brain_audit_logs (workspace_id, created_at desc, id desc);
create index brain_audit_logs_actor_recent_idx on public.brain_audit_logs (workspace_id, actor_user_id, created_at desc, id desc);
create index brain_audit_logs_expiry_idx on public.brain_audit_logs (expires_at);
alter table public.brain_audit_logs enable row level security;
revoke all on public.brain_audit_logs from public, anon, authenticated, service_role;
grant select on public.brain_audit_logs to authenticated;
grant select, insert, delete on public.brain_audit_logs to service_role;
create policy "Workspace owner reviews unexpired Brain audits" on public.brain_audit_logs
  for select to authenticated using (
    expires_at > now() and exists (
      select 1 from public.workspace_members m where m.workspace_id = brain_audit_logs.workspace_id
        and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'owner'
    )
  );
create function public.prune_expired_brain_audits_service() returns bigint
  language plpgsql security invoker set search_path = public as $$
declare deleted_count bigint;
begin
  delete from public.brain_audit_logs where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke execute on function public.prune_expired_brain_audits_service() from public, anon, authenticated;
grant execute on function public.prune_expired_brain_audits_service() to service_role;
comment on table public.brain_audit_logs is 'Owner-only 30-day audit copies; personal Brain memory and history have a separate lifetime. Credential fields are redacted before insert.';
