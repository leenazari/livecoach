-- Save the company, its primary contact and the optional outreach identity in
-- one database transaction. The previous browser-side three-request flow
-- could be interrupted after the company request and leave an empty client.

create or replace function public.create_complete_crm_client(
  p_workspace_id uuid,
  p_company_name text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_job_title text,
  p_record_type text,
  p_relationship_stage text,
  p_existing_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  company_name_value text := regexp_replace(trim(coalesce(p_company_name, '')), '\s+', ' ', 'g');
  first_name_value text := regexp_replace(trim(coalesce(p_first_name, '')), '\s+', ' ', 'g');
  last_name_value text := regexp_replace(trim(coalesce(p_last_name, '')), '\s+', ' ', 'g');
  contact_name_value text;
  email_value text := lower(trim(coalesce(p_email, '')));
  job_title_value text := regexp_replace(trim(coalesce(p_job_title, '')), '\s+', ' ', 'g');
  record_type_value text := lower(trim(coalesce(p_record_type, '')));
  stage_value text := trim(coalesce(p_relationship_stage, ''));
  company_row public.companies%rowtype;
  contact_row public.contacts%rowtype;
  prospect_row public.outreach_prospects%rowtype;
  company_match_count integer := 0;
  contact_match_count integer := 0;
  other_contact_count integer := 0;
  company_created boolean := false;
  contact_created boolean := false;
  prospect_created boolean := false;
  prospect_reused boolean := false;
  has_company_access boolean := false;
  team_lead_cover boolean := false;
begin
  if actor_id is null then
    raise exception 'complete_client_auth_required';
  end if;

  select wm.role
    into actor_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = actor_id
    and wm.status = 'active';

  if actor_role is null then
    raise exception 'complete_client_membership_required';
  end if;

  if company_name_value = '' or length(company_name_value) > 200 then
    raise exception 'complete_client_company_invalid';
  end if;
  if first_name_value = '' or length(first_name_value) > 120
    or length(last_name_value) > 120 then
    raise exception 'complete_client_contact_name_invalid';
  end if;
  if length(email_value) > 320
    or email_value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'complete_client_email_invalid';
  end if;
  if length(job_title_value) > 200 then
    raise exception 'complete_client_job_title_invalid';
  end if;
  if record_type_value not in ('prospect', 'relationship') then
    raise exception 'complete_client_record_type_invalid';
  end if;
  if record_type_value = 'prospect' then
    stage_value := 'New';
  elsif stage_value not in (
    'Discovery', 'Qualified', 'Proposal', 'Negotiation', 'Partner',
    'Customer', 'Product Trial', 'In House', 'Dormant'
  ) then
    raise exception 'complete_client_stage_invalid';
  end if;

  contact_name_value := trim(concat_ws(' ', first_name_value, nullif(last_name_value, '')));

  if p_existing_company_id is not null then
    select c.*
      into company_row
    from public.companies c
    where c.id = p_existing_company_id
      and c.workspace_id = p_workspace_id;

    if not found then
      raise exception 'complete_client_company_not_found';
    end if;
    if lower(regexp_replace(trim(company_row.name), '\s+', ' ', 'g'))
      is distinct from lower(company_name_value) then
      raise exception 'complete_client_company_name_mismatch';
    end if;

    select coalesce(w.team_lead_cover_enabled, false)
      into team_lead_cover
    from public.workspaces w
    where w.id = p_workspace_id;

    has_company_access := company_row.owner_id = actor_id
      or exists (
        select 1
        from public.team_client_shares tcs
        where tcs.workspace_id = p_workspace_id
          and tcs.company_id = company_row.id
          and tcs.assigned_to_user_id = actor_id
          and tcs.status = 'active'
          and company_row.is_confidential = false
      )
      or (
        team_lead_cover
        and company_row.is_confidential = false
        and lower(coalesce(company_row.profile #>> '{internal}', 'false')) <> 'true'
        and lower(concat_ws(
          ' | ',
          company_row.profile #>> '{triage,classification}',
          company_row.stage,
          company_row.sector
        )) !~ (
          '\m(invest(or|ment)?|in[ _-]?house|internal|employee|staff|board|adviser|advisor|product[ _-]?trial|vendor|supplier|personal|private)\M'
          || '|\m(strategic|major|large|confidential|private)[ _-]?partner(ship)?\M'
          || '|\mpartner(ship)?[ _-]?(strategic|major|large|confidential|private)\M'
        )
      );

    if not has_company_access then
      raise exception 'complete_client_company_access_blocked';
    end if;
  else
    select count(*)::integer
      into company_match_count
    from public.companies c
    where c.workspace_id = p_workspace_id
      and c.owner_id = actor_id
      and lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) = lower(company_name_value);

    if company_match_count > 1 then
      raise exception 'complete_client_company_ambiguous';
    elsif company_match_count = 1 then
      select c.*
        into company_row
      from public.companies c
      where c.workspace_id = p_workspace_id
        and c.owner_id = actor_id
        and lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) = lower(company_name_value)
      limit 1;
    else
      insert into public.companies (
        owner_id,
        workspace_id,
        visibility,
        name,
        stage
      ) values (
        actor_id,
        p_workspace_id,
        'private',
        company_name_value,
        stage_value
      )
      returning * into company_row;
      company_created := true;
    end if;
  end if;

  if record_type_value = 'prospect'
    and lower(coalesce(trim(company_row.stage), '')) <> 'new' then
    raise exception 'complete_client_existing_stage_conflict';
  end if;

  -- The whole workspace shares one exact-email outreach identity. The person
  -- can be reused only by their owner, current assignee, or the salesperson
  -- explicitly claiming an unassigned team lead.
  if record_type_value = 'prospect' then
    select op.*
      into prospect_row
    from public.outreach_prospects op
    where op.workspace_id = p_workspace_id
      and lower(trim(op.email)) = email_value
    limit 1;

    if found then
      prospect_reused := true;
      if prospect_row.owner_id <> actor_id
        and prospect_row.assigned_to_user_id is distinct from actor_id
        and not (
          prospect_row.assigned_to_user_id is null
          and prospect_row.visibility = 'team'
        ) then
        raise exception 'complete_client_prospect_owned_elsewhere';
      end if;
      if prospect_row.crm_company_id is not null
        and prospect_row.crm_company_id <> company_row.id then
        raise exception 'complete_client_prospect_company_conflict';
      end if;

      if prospect_row.assigned_to_user_id is null then
        update public.outreach_prospects
        set assigned_to_user_id = actor_id,
            updated_at = now()
        where id = prospect_row.id
          and workspace_id = p_workspace_id
        returning * into prospect_row;
      end if;

      update public.outreach_prospects
      set crm_company_id = company_row.id,
          company_name = company_row.name,
          updated_at = now()
      where id = prospect_row.id
        and workspace_id = p_workspace_id
      returning * into prospect_row;
    else
      insert into public.outreach_prospects (
        owner_id,
        workspace_id,
        visibility,
        assigned_to_user_id,
        email,
        first_name,
        last_name,
        job_title,
        company_name,
        crm_company_id,
        priority,
        status,
        source_file,
        source_sheet,
        source_metadata
      ) values (
        actor_id,
        p_workspace_id,
        'team',
        actor_id,
        email_value,
        first_name_value,
        nullif(last_name_value, ''),
        nullif(job_title_value, ''),
        company_row.name,
        company_row.id,
        'low',
        'imported',
        'LiveCoach manual entry',
        'Outreach Prospects',
        jsonb_build_object(
          'manual_entry',
          jsonb_build_object(
            'created_at', now(),
            'created_by', actor_id,
            'linked_client_id', company_row.id
          )
        )
      )
      returning * into prospect_row;
      prospect_created := true;
    end if;
  end if;

  select count(*)::integer
    into other_contact_count
  from public.contacts c
  where c.workspace_id = p_workspace_id
    and lower(trim(coalesce(c.email, ''))) = email_value
    and c.owner_id <> actor_id;

  if other_contact_count > 0 then
    raise exception 'complete_client_contact_owned_elsewhere';
  end if;

  select count(*)::integer
    into contact_match_count
  from public.contacts c
  where c.workspace_id = p_workspace_id
    and c.owner_id = actor_id
    and lower(trim(coalesce(c.email, ''))) = email_value;

  if contact_match_count > 1 then
    raise exception 'complete_client_contact_ambiguous';
  elsif contact_match_count = 1 then
    select c.*
      into contact_row
    from public.contacts c
    where c.workspace_id = p_workspace_id
      and c.owner_id = actor_id
      and lower(trim(coalesce(c.email, ''))) = email_value
    limit 1;

    if contact_row.company_id is distinct from company_row.id then
      raise exception 'complete_client_contact_company_conflict';
    end if;
  else
    insert into public.contacts (
      owner_id,
      workspace_id,
      visibility,
      company_id,
      name,
      email,
      role
    ) values (
      actor_id,
      p_workspace_id,
      'private',
      company_row.id,
      contact_name_value,
      email_value,
      nullif(job_title_value, '')
    )
    returning * into contact_row;
    contact_created := true;
  end if;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', company_row.id,
      'name', company_row.name,
      'stage', company_row.stage,
      'owner_id', company_row.owner_id,
      'workspace_id', company_row.workspace_id,
      'created_at', company_row.created_at,
      'updated_at', company_row.updated_at
    ),
    'contact', jsonb_build_object(
      'id', contact_row.id,
      'company_id', contact_row.company_id,
      'name', contact_row.name,
      'email', contact_row.email,
      'role', contact_row.role,
      'owner_id', contact_row.owner_id
    ),
    'prospect', case
      when record_type_value = 'prospect' then jsonb_build_object(
        'id', prospect_row.id,
        'email', prospect_row.email,
        'crm_company_id', prospect_row.crm_company_id,
        'assigned_to_user_id', prospect_row.assigned_to_user_id,
        'status', prospect_row.status
      )
      else null
    end,
    'companyCreated', company_created,
    'contactCreated', contact_created,
    'prospectCreated', prospect_created,
    'prospectReused', prospect_reused,
    'recordType', record_type_value
  );
end;
$$;

comment on function public.create_complete_crm_client(
  uuid, text, text, text, text, text, text, text, uuid
) is 'Atomically creates or reuses an accessible CRM company, the signed-in user primary contact and an optional assigned outreach identity.';

revoke all on function public.create_complete_crm_client(
  uuid, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.create_complete_crm_client(
  uuid, text, text, text, text, text, text, text, uuid
) to authenticated;
