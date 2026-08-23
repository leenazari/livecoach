-- Add an explicit owner-controlled privacy lock above ordinary client sharing.
-- Sharing remains private by default. Unlocking a client never shares it or
-- restores a previous salesperson assignment.

alter table public.companies
  add column if not exists is_confidential boolean not null default false;

comment on column public.companies.is_confidential is
  'Owner-only hard privacy lock. Confidential clients cannot be shared with team members or exposed to the shared Brain.';

create or replace function public.prevent_confidential_client_sharing()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'active' and exists (
    select 1
    from public.companies c
    where c.id = new.company_id
      and c.workspace_id = new.workspace_id
      and c.is_confidential = true
  ) then
    raise exception 'confidential clients cannot be shared';
  end if;

  return new;
end;
$$;

drop trigger if exists team_client_shares_block_confidential
  on public.team_client_shares;
create trigger team_client_shares_block_confidential
  before insert or update of status, company_id, workspace_id
  on public.team_client_shares
  for each row execute function public.prevent_confidential_client_sharing();

revoke execute on function public.prevent_confidential_client_sharing()
  from public, anon, authenticated;

create or replace function public.prevent_confidential_opportunity_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.company_id is not null and exists (
    select 1
    from public.companies c
    where c.id = new.company_id
      and c.workspace_id = new.workspace_id
      and c.is_confidential = true
  ) then
    if new.assigned_to_user_id is null then
      new.assigned_to_user_id := new.owner_id;
    end if;

    if new.assigned_to_user_id is distinct from new.owner_id
      or new.visibility is distinct from 'private' then
      raise exception 'confidential client opportunities must stay owner only';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists opportunities_block_confidential_assignment
  on public.opportunities;
create trigger opportunities_block_confidential_assignment
  before insert or update of company_id, workspace_id, owner_id, assigned_to_user_id, visibility
  on public.opportunities
  for each row execute function public.prevent_confidential_opportunity_assignment();

revoke execute on function public.prevent_confidential_opportunity_assignment()
  from public, anon, authenticated;

create or replace function public.enforce_company_confidentiality()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  changed_at timestamptz := now();
begin
  if new.is_confidential is not distinct from old.is_confidential then
    return new;
  end if;

  if new.is_confidential then
    update public.team_client_shares tcs
    set status = 'revoked',
        assigned_to_user_id = null
    where tcs.workspace_id = new.workspace_id
      and tcs.company_id = new.id
      and (
        tcs.status is distinct from 'revoked'
        or tcs.assigned_to_user_id is not null
      );

    update public.opportunities opportunity
    set assigned_to_user_id = new.owner_id,
        visibility = 'private',
        updated_at = changed_at,
        last_change_context = jsonb_build_object(
          'nonce', gen_random_uuid()::text,
          'sourceType', case when actor_id is null then 'system' else 'human' end,
          'sourceChannel', 'client_confidentiality',
          'rationale', 'Confidential client lock removed team access',
          'evidence', '{}'::jsonb
        )
    where opportunity.workspace_id = new.workspace_id
      and opportunity.owner_id = new.owner_id
      and opportunity.company_id = new.id
      and opportunity.status = 'open'
      and opportunity.opportunity_type = 'revenue'
      and (
        opportunity.assigned_to_user_id is distinct from new.owner_id
        or opportunity.visibility is distinct from 'private'
      );
  end if;

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
    case
      when new.is_confidential then 'client_confidentiality_locked'
      else 'client_confidentiality_unlocked'
    end,
    'companies',
    new.id::text,
    jsonb_build_object('confidential', old.is_confidential),
    jsonb_build_object(
      'confidential', new.is_confidential,
      'salesAccess', 'revoked'
    )
  );

  return new;
end;
$$;

drop trigger if exists companies_enforce_confidentiality
  on public.companies;
create trigger companies_enforce_confidentiality
  after update of is_confidential
  on public.companies
  for each row execute function public.enforce_company_confidentiality();

revoke execute on function public.enforce_company_confidentiality()
  from public, anon, authenticated;

-- Pre-lock only relationship types which are already forbidden by the current
-- sharing policy. Ordinary partners and normal sales clients remain private by
-- default and can still be deliberately shared by the owner.
update public.companies c
set is_confidential = true,
    updated_at = now()
where c.is_confidential = false
  and lower(concat_ws(
    ' | ',
    c.profile #>> '{triage,classification}',
    c.stage,
    c.sector
  )) ~ (
    '\m(invest(or|ment)?|in[ _-]?house|internal|employee|staff|board|adviser|advisor|product[ _-]?trial|vendor|supplier|personal|private)\M'
    || '|\m(strategic|major|large|confidential|private)[ _-]?partner(ship)?\M'
    || '|\mpartner(ship)?[ _-]?(strategic|major|large|confidential|private)\M'
  );

-- A stale grant must remain invisible even if it predates the trigger above.
drop policy if exists "Members read active shared clients"
  on public.team_client_shares;
create policy "Members read active shared clients"
  on public.team_client_shares for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = team_client_shares.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role = 'owner'
          or (
            team_client_shares.status = 'active'
            and exists (
              select 1
              from public.companies c
              where c.id = team_client_shares.company_id
                and c.workspace_id = team_client_shares.workspace_id
                and c.is_confidential = false
            )
          )
        )
    )
  );

drop policy if exists "Owners share their private clients"
  on public.team_client_shares;
create policy "Owners share their private clients"
  on public.team_client_shares for insert to authenticated
  with check (
    shared_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = team_client_shares.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
    and exists (
      select 1
      from public.companies c
      where c.id = team_client_shares.company_id
        and c.workspace_id = team_client_shares.workspace_id
        and c.owner_id = (select auth.uid())
        and c.is_confidential = false
    )
  );

drop policy if exists "Owners change their client sharing"
  on public.team_client_shares;
create policy "Owners change their client sharing"
  on public.team_client_shares for update to authenticated
  using (
    shared_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = team_client_shares.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  )
  with check (
    shared_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.companies c
      where c.id = team_client_shares.company_id
        and c.workspace_id = team_client_shares.workspace_id
        and c.owner_id = (select auth.uid())
        and (
          team_client_shares.status <> 'active'
          or c.is_confidential = false
        )
    )
  );

create or replace function public.set_company_confidentiality_service(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_confidential boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  client_workspace_id uuid;
  existing_confidential boolean;
  opportunities_to_reset integer := 0;
  active_share boolean := false;
  changed_at timestamptz := now();
begin
  if p_actor_user_id is null or p_confidential is null then
    raise exception 'verified owner access and a privacy choice are required';
  end if;

  select c.workspace_id, c.is_confidential
  into client_workspace_id, existing_confidential
  from public.companies c
  join public.workspace_members wm
    on wm.workspace_id = c.workspace_id
   and wm.user_id = p_actor_user_id
   and wm.status = 'active'
   and wm.role = 'owner'
  where c.id = p_company_id
    and c.owner_id = p_actor_user_id;

  if client_workspace_id is null then
    raise exception 'only your own client records can be locked';
  end if;

  if p_confidential then
    select count(*)::integer
    into opportunities_to_reset
    from public.opportunities opportunity
    where opportunity.workspace_id = client_workspace_id
      and opportunity.owner_id = p_actor_user_id
      and opportunity.company_id = p_company_id
      and opportunity.status = 'open'
      and opportunity.opportunity_type = 'revenue'
      and (
        opportunity.assigned_to_user_id is distinct from p_actor_user_id
        or opportunity.visibility is distinct from 'private'
      );
  end if;

  -- Preserve the real owner on the immutable access audit even though the
  -- trusted server calls this service-role-only function.
  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_actor_user_id,
      'role', 'authenticated'
    )::text,
    true
  );

  update public.companies c
  set is_confidential = p_confidential,
      updated_at = changed_at
  where c.id = p_company_id
    and c.workspace_id = client_workspace_id
    and c.owner_id = p_actor_user_id
    and c.is_confidential is distinct from p_confidential;

  select exists (
    select 1
    from public.team_client_shares tcs
    where tcs.workspace_id = client_workspace_id
      and tcs.company_id = p_company_id
      and tcs.status = 'active'
  ) into active_share;

  return jsonb_build_object(
    'companyId', p_company_id,
    'confidential', p_confidential,
    'shared', active_share,
    'opportunitiesUpdated', opportunities_to_reset,
    'updatedAt', changed_at
  );
end;
$$;

revoke all on function public.set_company_confidentiality_service(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_company_confidentiality_service(uuid, uuid, boolean)
  to service_role;

comment on function public.set_company_confidentiality_service(uuid, uuid, boolean) is
  'Server-only owner-verified confidentiality control. Locking revokes safe sharing and returns open revenue work to the owner. Unlocking never restores access.';

-- Recreate the existing atomic assignment function with the explicit hard lock
-- and the complete protected relationship vocabulary enforced in the database.
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
  client_confidential boolean;
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
      ' | ',
      c.profile #>> '{triage,classification}',
      c.stage,
      c.sector
    )),
    c.is_confidential
  into client_workspace_id, client_classification, client_confidential
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

  if p_shared and client_confidential then
    raise exception 'confidential clients cannot be shared';
  end if;

  if p_shared and client_classification ~ (
    '\m(invest(or|ment)?|in[ _-]?house|internal|employee|staff|board|adviser|advisor|product[ _-]?trial|vendor|supplier|personal|private)\M'
    || '|\m(strategic|major|large|confidential|private)[ _-]?partner(ship)?\M'
    || '|\mpartner(ship)?[ _-]?(strategic|major|large|confidential|private)\M'
  ) then
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
    set status = 'revoked',
        assigned_to_user_id = null
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
  'Server-only atomic assignment of a non-confidential safe shared client and its open revenue work. The function independently verifies the human owner and assignee.';
