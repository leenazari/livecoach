-- A shared sales client has one accountable teammate. This is operational
-- ownership only. The source company's privacy owner, calls, transcripts,
-- mailbox context, documents and Brain history remain unchanged.

alter table public.team_client_shares
  add column if not exists assigned_to_user_id uuid,
  add column if not exists assigned_by_user_id uuid,
  add column if not exists assigned_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_client_shares_assigned_to_user_id_fkey'
      and conrelid = 'public.team_client_shares'::regclass
  ) then
    alter table public.team_client_shares
      add constraint team_client_shares_assigned_to_user_id_fkey
      foreign key (assigned_to_user_id) references auth.users(id)
      on delete restrict not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_client_shares_assigned_by_user_id_fkey'
      and conrelid = 'public.team_client_shares'::regclass
  ) then
    alter table public.team_client_shares
      add constraint team_client_shares_assigned_by_user_id_fkey
      foreign key (assigned_by_user_id) references auth.users(id)
      on delete restrict not valid;
  end if;
end
$$;

-- Preserve any pre-existing active grants by assigning them to the owner who
-- explicitly shared them. Production currently has no shared client rows, but
-- this makes the migration safe and repeatable in every environment.
update public.team_client_shares
set assigned_to_user_id = coalesce(assigned_to_user_id, shared_by_user_id),
    assigned_by_user_id = coalesce(assigned_by_user_id, shared_by_user_id),
    assigned_at = coalesce(assigned_at, updated_at, created_at, now())
where status = 'active'
  and assigned_to_user_id is null;

alter table public.team_client_shares
  drop constraint if exists team_client_shares_active_assignment_check,
  add constraint team_client_shares_active_assignment_check
    check (status <> 'active' or assigned_to_user_id is not null) not valid;

alter table public.team_client_shares
  validate constraint team_client_shares_assigned_to_user_id_fkey,
  validate constraint team_client_shares_assigned_by_user_id_fkey,
  validate constraint team_client_shares_active_assignment_check;

create index if not exists team_client_shares_workspace_assignee_status_idx
  on public.team_client_shares (
    workspace_id,
    assigned_to_user_id,
    status,
    updated_at desc
  );

create or replace function public.validate_team_client_share_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if new.status = 'active' and new.assigned_to_user_id is null then
    raise exception 'an active shared client must have a salesperson';
  end if;

  if new.assigned_to_user_id is not null and not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.assigned_to_user_id
      and wm.status = 'active'
  ) then
    raise exception 'the assigned salesperson is not an active workspace member';
  end if;

  if tg_op = 'INSERT'
    or new.assigned_to_user_id is distinct from old.assigned_to_user_id then
    new.assigned_by_user_id := coalesce(actor_id, new.assigned_by_user_id, new.shared_by_user_id);
    new.assigned_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.audit_team_client_share()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  action_name text;
begin
  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.assigned_to_user_id is not distinct from old.assigned_to_user_id then
    return new;
  end if;

  action_name := case
    when tg_op = 'UPDATE'
      and new.assigned_to_user_id is distinct from old.assigned_to_user_id
      then 'client_sales_assignment_changed'
    when new.status = 'active' then 'client_sales_access_shared'
    else 'client_sales_access_revoked'
  end;

  insert into public.access_audit_events (
    workspace_id,
    actor_user_id,
    source,
    action,
    target_table,
    target_id,
    previous_scope,
    next_scope
  ) values (
    new.workspace_id,
    actor_id,
    case when actor_id is null then 'system' else 'human' end,
    action_name,
    'companies',
    new.company_id::text,
    case
      when tg_op = 'UPDATE' then jsonb_build_object(
        'salesAccess', old.status,
        'assignedToUserId', old.assigned_to_user_id
      )
      else '{}'::jsonb
    end,
    jsonb_build_object(
      'salesAccess', new.status,
      'assignedToUserId', new.assigned_to_user_id
    )
  );

  return new;
end;
$$;

drop trigger if exists team_client_shares_validate_assignment
  on public.team_client_shares;
create trigger team_client_shares_validate_assignment
  before insert or update of assigned_to_user_id, workspace_id, status
  on public.team_client_shares
  for each row execute function public.validate_team_client_share_assignment();

drop trigger if exists team_client_shares_audit
  on public.team_client_shares;
create trigger team_client_shares_audit
  after insert or update of status, assigned_to_user_id
  on public.team_client_shares
  for each row execute function public.audit_team_client_share();

revoke execute on function public.validate_team_client_share_assignment()
  from public, anon, authenticated;
revoke execute on function public.audit_team_client_share()
  from public, anon, authenticated;

comment on column public.team_client_shares.assigned_to_user_id is
  'Active teammate accountable for this safe shared sales client. This does not grant access to the private source company row.';
comment on column public.team_client_shares.assigned_by_user_id is
  'Workspace owner who made the latest sales assignment.';
comment on column public.team_client_shares.assigned_at is
  'Time the current salesperson assignment was confirmed.';

-- Change safe client access and its open revenue work in one transaction.
-- The function runs with the signed-in owner's RLS rights. It does not grant
-- access to calls, transcripts, mailbox context, documents or Brain history.
create or replace function public.set_team_client_sales_assignment(
  p_company_id uuid,
  p_shared boolean,
  p_assigned_to_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  client_workspace_id uuid;
  client_classification text;
  saved public.team_client_shares%rowtype;
  opportunities_updated integer := 0;
  changed_at timestamptz := now();
begin
  if actor_id is null then
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
   and wm.user_id = actor_id
   and wm.status = 'active'
   and wm.role = 'owner'
  where c.id = p_company_id
    and c.owner_id = actor_id;

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
      actor_id,
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
        else actor_id
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
    and opportunity.owner_id = actor_id
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

revoke execute on function public.set_team_client_sales_assignment(uuid, boolean, uuid)
  from public, anon;
grant execute on function public.set_team_client_sales_assignment(uuid, boolean, uuid)
  to authenticated;

comment on function public.set_team_client_sales_assignment(uuid, boolean, uuid) is
  'Owner-only atomic assignment of a safe shared client and its open revenue work. The narrow definer boundary verifies auth.uid, owner membership, company ownership, assignee membership and protected relationship classes before writing.';
