-- Per-user audit receipts for the narrow ChatGPT MCP surface. OAuth tokens
-- remain ordinary Supabase user tokens, so auth.uid(), workspace membership
-- and every existing CRM RLS policy remain the final authority.

create table if not exists public.mcp_action_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  oauth_client_id text not null,
  tool_name text not null check (
    tool_name in (
      'find_my_lead',
      'list_my_leads',
      'add_lead',
      'add_lead_context',
      'create_my_follow_up',
      'list_my_tasks'
    )
  ),
  outcome text not null default 'started' check (
    outcome in ('started', 'created', 'updated', 'existing', 'read', 'failed')
  ),
  target_table text check (
    target_table is null or target_table in ('outreach_prospects', 'tasks')
  ),
  target_id uuid,
  request_fingerprint text not null,
  request_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists mcp_action_receipts_request_uidx
  on public.mcp_action_receipts (
    workspace_id,
    actor_user_id,
    oauth_client_id,
    request_fingerprint
  );

create index if not exists mcp_action_receipts_actor_created_idx
  on public.mcp_action_receipts (workspace_id, actor_user_id, created_at desc);

alter table public.mcp_action_receipts enable row level security;

revoke all on table public.mcp_action_receipts from public, anon;
grant select, insert, update on table public.mcp_action_receipts to authenticated;
grant select, insert, update, delete on table public.mcp_action_receipts to service_role;

drop policy if exists "Members read permitted MCP receipts"
  on public.mcp_action_receipts;
create policy "Members read permitted MCP receipts"
  on public.mcp_action_receipts for select to authenticated
  using (
    actor_user_id = (select auth.uid())
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = mcp_action_receipts.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  );

drop policy if exists "OAuth users create their own MCP receipts"
  on public.mcp_action_receipts;
create policy "OAuth users create their own MCP receipts"
  on public.mcp_action_receipts for insert to authenticated
  with check (
    actor_user_id = (select auth.uid())
    and oauth_client_id = coalesce((select auth.jwt() ->> 'client_id'), '')
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = mcp_action_receipts.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

drop policy if exists "OAuth users finish their own MCP receipts"
  on public.mcp_action_receipts;
create policy "OAuth users finish their own MCP receipts"
  on public.mcp_action_receipts for update to authenticated
  using (
    actor_user_id = (select auth.uid())
    and oauth_client_id = coalesce((select auth.jwt() ->> 'client_id'), '')
  )
  with check (
    actor_user_id = (select auth.uid())
    and oauth_client_id = coalesce((select auth.jwt() ->> 'client_id'), '')
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = mcp_action_receipts.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create or replace function public.protect_mcp_action_receipt_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.actor_user_id is distinct from old.actor_user_id
    or new.oauth_client_id is distinct from old.oauth_client_id
    or new.tool_name is distinct from old.tool_name
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.request_summary is distinct from old.request_summary
    or new.created_at is distinct from old.created_at then
    raise exception 'MCP receipt identity cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists mcp_action_receipts_protect_identity
  on public.mcp_action_receipts;
create trigger mcp_action_receipts_protect_identity
  before update on public.mcp_action_receipts
  for each row execute function public.protect_mcp_action_receipt_identity();

revoke execute on function public.protect_mcp_action_receipt_identity()
  from public, anon, authenticated;

comment on table public.mcp_action_receipts is
  'Append-only identity and outcome receipts for staff actions initiated through an OAuth-authenticated MCP client.';
