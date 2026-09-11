-- Assign outreach work and the minimum safe company access in one transaction.
-- A team-visible prospect is the owner's pre-authorised sales inventory. When
-- it is assigned, the salesperson receives only the existing safe company
-- projection. Private notes, email context, calls, transcripts, documents and
-- Brain memory remain protected by company RLS and the safe projection loader.

create or replace function public.assign_outreach_prospects_with_company_access_service(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_prospect_ids uuid[],
  p_assigned_to_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_role text;
  requested_count integer := 0;
  target_count integer := 0;
  shared_count integer := 0;
  skipped_linked_companies integer := 0;
  changed_at timestamptz := now();
  assigned_ids uuid[] := '{}'::uuid[];
  company_record record;
  company_labels text;
  affected_rows integer := 0;
begin
  if p_actor_user_id is null
    or p_workspace_id is null
    or p_assigned_to_user_id is null then
    raise exception 'verified workspace actor, workspace and assignee are required';
  end if;

  select count(*)::integer
  into requested_count
  from (
    select distinct prospect_id
    from unnest(coalesce(p_prospect_ids, '{}'::uuid[])) prospect_id
    where prospect_id is not null
  ) requested;

  if requested_count < 1 or requested_count > 1000 then
    raise exception 'choose between 1 and 1000 prospects';
  end if;

  select wm.role
  into actor_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = p_actor_user_id
    and wm.status = 'active';

  if actor_role not in ('owner', 'manager', 'sales') then
    raise exception 'only an active sales user, manager or owner can assign outreach';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_assigned_to_user_id
      and wm.status = 'active'
  ) then
    raise exception 'choose an active member of this workspace';
  end if;

  -- Lock every requested prospect before checking claim authority. This keeps
  -- two salespeople from successfully claiming the same shared prospect.
  perform prospect.id
  from public.outreach_prospects prospect
  where prospect.workspace_id = p_workspace_id
    and prospect.id = any(p_prospect_ids)
  order by prospect.id
  for update;

  select count(*)::integer
  into target_count
  from public.outreach_prospects prospect
  where prospect.workspace_id = p_workspace_id
    and prospect.id = any(p_prospect_ids);

  if target_count <> requested_count then
    raise exception 'one or more outreach prospects are unavailable';
  end if;

  if actor_role = 'sales' then
    if p_actor_user_id <> p_assigned_to_user_id then
      raise exception 'salespeople can only claim outreach for themselves';
    end if;

    if exists (
      select 1
      from public.outreach_prospects prospect
      where prospect.workspace_id = p_workspace_id
        and prospect.id = any(p_prospect_ids)
        and not (
          prospect.assigned_to_user_id = p_actor_user_id
          or (
            prospect.assigned_to_user_id is null
            and prospect.visibility = 'team'
          )
        )
    ) then
      raise exception 'another teammate claimed this prospect first';
    end if;
  elsif exists (
    select 1
    from public.outreach_prospects prospect
    where prospect.workspace_id = p_workspace_id
      and prospect.id = any(p_prospect_ids)
      and prospect.owner_id <> p_actor_user_id
      and prospect.visibility <> 'team'
      and prospect.assigned_to_user_id is distinct from p_actor_user_id
  ) then
    raise exception 'one or more outreach prospects are private to another user';
  end if;

  -- Preserve the initiating human in both assignment and safe-share audits,
  -- even though this service-only function executes with the server role.
  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_actor_user_id,
      'role', 'authenticated'
    )::text,
    true
  );

  update public.outreach_prospects prospect
  set assigned_to_user_id = p_assigned_to_user_id,
      visibility = 'team',
      updated_at = changed_at
  where prospect.workspace_id = p_workspace_id
    and prospect.id = any(p_prospect_ids);

  select coalesce(array_agg(prospect.id order by prospect.id), '{}'::uuid[])
  into assigned_ids
  from public.outreach_prospects prospect
  where prospect.workspace_id = p_workspace_id
    and prospect.id = any(p_prospect_ids)
    and prospect.assigned_to_user_id = p_assigned_to_user_id;

  for company_record in
    select distinct
      company.id,
      company.owner_id,
      company.stage,
      company.sector,
      company.profile,
      company.is_confidential
    from public.outreach_prospects prospect
    join public.companies company
      on company.id = prospect.crm_company_id
     and company.workspace_id = prospect.workspace_id
    where prospect.workspace_id = p_workspace_id
      and prospect.id = any(p_prospect_ids)
      and prospect.assigned_to_user_id = p_assigned_to_user_id
      and company.owner_id <> p_assigned_to_user_id
  loop
    company_labels := lower(concat_ws(
      ' | ',
      company_record.profile #>> '{triage,classification}',
      company_record.stage,
      company_record.sector
    ));

    -- Only a positively confirmed New lead without an open opportunity can
    -- gain automatic sales access. Every other CRM relationship still fails
    -- closed and must be reviewed by its owner.
    if company_record.is_confidential
      or lower(trim(coalesce(company_record.stage, ''))) <> 'new'
      or company_labels ~ (
        '\m(invest(or|ment)?|in[ _-]?house|internal|employee|staff|board|adviser|advisor|product[ _-]?trial|vendor|supplier|personal|private)\M'
        || '|\m(strategic|major|large|confidential|private)[ _-]?partner(ship)?\M'
        || '|\mpartner(ship)?[ _-]?(strategic|major|large|confidential|private)\M'
      )
      or exists (
        select 1
        from public.opportunities opportunity
        where opportunity.workspace_id = p_workspace_id
          and opportunity.company_id = company_record.id
          and opportunity.status = 'open'
      ) then
      skipped_linked_companies := skipped_linked_companies + 1;
      continue;
    end if;

    if actor_role = 'sales' and exists (
      select 1
      from public.team_client_shares share
      where share.workspace_id = p_workspace_id
        and share.company_id = company_record.id
        and share.status = 'active'
        and share.assigned_to_user_id <> p_assigned_to_user_id
    ) then
      raise exception 'this company is already assigned to another salesperson';
    end if;

    insert into public.team_client_shares (
      workspace_id,
      company_id,
      shared_by_user_id,
      assigned_to_user_id,
      assigned_by_user_id,
      assigned_at,
      status
    ) values (
      p_workspace_id,
      company_record.id,
      company_record.owner_id,
      p_assigned_to_user_id,
      p_actor_user_id,
      changed_at,
      'active'
    )
    on conflict (workspace_id, company_id) do update
      set status = 'active',
          assigned_to_user_id = excluded.assigned_to_user_id,
          assigned_by_user_id = excluded.assigned_by_user_id,
          assigned_at = excluded.assigned_at
      where team_client_shares.status <> 'active'
         or team_client_shares.assigned_to_user_id is distinct from excluded.assigned_to_user_id;
    get diagnostics affected_rows = row_count;
    if affected_rows > 0 then
      shared_count := shared_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'assignedIds', to_jsonb(assigned_ids),
    'assignedCount', cardinality(assigned_ids),
    'companyAccessShared', shared_count,
    'linkedCompaniesHeldPrivate', skipped_linked_companies,
    'assignedToUserId', p_assigned_to_user_id,
    'updatedAt', changed_at
  );
end;
$$;

revoke all on function public.assign_outreach_prospects_with_company_access_service(
  uuid,
  uuid,
  uuid[],
  uuid
) from public, anon, authenticated;
grant execute on function public.assign_outreach_prospects_with_company_access_service(
  uuid,
  uuid,
  uuid[],
  uuid
) to service_role;

comment on function public.assign_outreach_prospects_with_company_access_service(
  uuid,
  uuid,
  uuid[],
  uuid
) is
  'Server-only atomic outreach assignment. It grants only the safe company projection for eligible New leads and preserves all private CRM context.';
