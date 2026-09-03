-- Keep the atomic client and deal assignment behind the verified server route.
-- The previous authenticated RPC remains unavailable after this migration.
revoke all on function public.set_team_client_sales_assignment(uuid, boolean, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.set_team_client_sales_assignment_service(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_shared boolean,
  p_assigned_to_user_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  client_workspace_id uuid;
  client_classification text;
  saved public.team_client_shares%rowtype;
  opportunities_updated integer := 0;
  changed_at timestamptz := now();
begin
  if p_actor_user_id is null then
    raise exception 'verified workspace access is required';
  end if;

  select
    c.workspace_id,
    lower(concat_ws(
      ' ',
      c.profile #>> '{triage,classification}',
      c.stage,
      c.sector
    ))
  into client_workspace_id, client_classification
  from public.companies c
  join public.workspace_members wm
    on wm.workspace_id = c.workspace_id
   and wm.user_id = p_actor_user_id
   and wm.status = 'active'
   and wm.role = 'owner'
  where c.id = p_company_id
    and c.owner_id = p_actor_user_id;

  if client_workspace_id is null then
    raise exception 'only your own client records can be shared';
  end if;

  if p_shared and p_assigned_to_user_id is null then
    raise exception 'choose the salesperson responsible for this client';
  end if;

  if p_shared and client_classification ~
    '\m(invest(or|ment)?|in[ _-]?house|internal|employee|staff|board|adviser|advisor|product[ _-]?trial|vendor|supplier|personal|private)\M' then
    raise exception 'this private relationship type cannot be shared with sales';
  end if;

  if p_shared and not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = client_workspace_id
      and wm.user_id = p_assigned_to_user_id
      and wm.status = 'active'
  ) then
    raise exception 'choose an active member of your sales team';
  end if;

  -- Trigger audit functions use auth.uid(). This transaction-local claim keeps
  -- the real human owner visible even though the server executes the function.
  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_actor_user_id,
      'role', 'authenticated'
    )::text,
    true
  );

  if p_shared then
    insert into public.team_client_shares (
      workspace_id,
      company_id,
      shared_by_user_id,
      assigned_to_user_id,
      status
    ) values (
      client_workspace_id,
      p_company_id,
      p_actor_user_id,
      p_assigned_to_user_id,
      'active'
    )
    on conflict (workspace_id, company_id) do update
      set status = 'active',
          assigned_to_user_id = excluded.assigned_to_user_id
    returning * into saved;
  else
    update public.team_client_shares tcs
    set status = 'revoked'
    where tcs.workspace_id = client_workspace_id
      and tcs.company_id = p_company_id
    returning * into saved;
  end if;

  update public.opportunities opportunity
  set assigned_to_user_id = case
        when p_shared then p_assigned_to_user_id
        else p_actor_user_id
      end,
      visibility = case when p_shared then 'team' else 'private' end,
      updated_at = changed_at,
      last_change_context = jsonb_build_object(
        'nonce', gen_random_uuid()::text,
        'sourceType', 'human',
        'sourceChannel', 'team_client_sharing',
        'rationale', case
          when p_shared then 'Client and open revenue work assigned together'
          else 'Client sharing revoked by the workspace owner'
        end,
        'evidence', '{}'::jsonb
      )
  where opportunity.workspace_id = client_workspace_id
    and opportunity.owner_id = p_actor_user_id
    and opportunity.company_id = p_company_id
    and opportunity.status = 'open'
    and opportunity.opportunity_type = 'revenue';
  get diagnostics opportunities_updated = row_count;

  return jsonb_build_object(
    'companyId', p_company_id,
    'shared', p_shared,
    'assignedToUserId', case
      when p_shared then p_assigned_to_user_id
      else null
    end,
    'assignedAt', case
      when p_shared then saved.assigned_at
      else null
    end,
    'opportunitiesUpdated', opportunities_updated,
    'updatedAt', coalesce(saved.updated_at, changed_at)
  );
end;
$$;

revoke all on function public.set_team_client_sales_assignment_service(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_team_client_sales_assignment_service(uuid, uuid, boolean, uuid)
  to service_role;

comment on function public.set_team_client_sales_assignment_service(uuid, uuid, boolean, uuid) is
  'Server-only atomic assignment of a safe shared client and its open revenue work. The function independently verifies the human owner and assignee.';
