-- Add or update one named contact on an owned sales client and link the same
-- identity to Outreach in one transaction. This repairs the old two-step flow
-- that could save a company without its person, while keeping all writes bound
-- to one verified workspace member.

create or replace function public.save_owned_client_outreach_contact_server(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_company_id uuid,
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_job_title text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  company_row public.companies%rowtype;
  contact_row public.contacts%rowtype;
  prospect_row public.outreach_prospects%rowtype;
  first_name_value text := regexp_replace(trim(coalesce(p_first_name, '')), '\s+', ' ', 'g');
  last_name_value text := regexp_replace(trim(coalesce(p_last_name, '')), '\s+', ' ', 'g');
  contact_name_value text;
  email_value text := lower(trim(coalesce(p_email, '')));
  job_title_value text := regexp_replace(trim(coalesce(p_job_title, '')), '\s+', ' ', 'g');
  contact_email_matches integer := 0;
  contact_name_matches integer := 0;
  contact_created boolean := false;
  prospect_created boolean := false;
begin
  if p_actor_id is null or not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_id
      and wm.status = 'active'
  ) then
    raise exception 'manual_prospect_membership_required';
  end if;

  if first_name_value = '' or length(first_name_value) > 120
    or length(last_name_value) > 120 then
    raise exception 'manual_prospect_contact_name_invalid';
  end if;
  if length(email_value) > 320
    or email_value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'manual_prospect_email_invalid';
  end if;
  if length(job_title_value) > 200 then
    raise exception 'manual_prospect_job_title_invalid';
  end if;

  contact_name_value := trim(concat_ws(' ', first_name_value, nullif(last_name_value, '')));

  select c.*
    into company_row
  from public.companies c
  where c.id = p_company_id
    and c.workspace_id = p_workspace_id
    and c.owner_id = p_actor_id
    and c.is_confidential = false
    and lower(coalesce(c.profile ->> 'archived', 'false')) <> 'true'
    and lower(coalesce(c.profile ->> 'deleted', 'false')) <> 'true';

  if not found then
    raise exception 'manual_prospect_client_not_owned';
  end if;
  if lower(trim(coalesce(company_row.stage, ''))) not in (
    '', 'new', 'prospect', 'discovery', 'qualified', 'demo', 'proposal', 'negotiation'
  ) then
    raise exception 'manual_prospect_client_stage_blocked';
  end if;

  if p_contact_id is not null then
    select ct.*
      into contact_row
    from public.contacts ct
    where ct.id = p_contact_id
      and ct.workspace_id = p_workspace_id
      and ct.owner_id = p_actor_id
      and ct.company_id = company_row.id;

    if not found then
      raise exception 'manual_prospect_contact_not_owned';
    end if;
    if nullif(lower(trim(coalesce(contact_row.email, ''))), '') is not null
      and lower(trim(contact_row.email)) <> email_value then
      raise exception 'manual_prospect_contact_email_conflict';
    end if;
  else
    select count(*)::integer
      into contact_email_matches
    from public.contacts ct
    where ct.workspace_id = p_workspace_id
      and lower(trim(coalesce(ct.email, ''))) = email_value;

    if contact_email_matches > 1 then
      raise exception 'manual_prospect_contact_ambiguous';
    elsif contact_email_matches = 1 then
      select ct.*
        into contact_row
      from public.contacts ct
      where ct.workspace_id = p_workspace_id
        and lower(trim(coalesce(ct.email, ''))) = email_value
      limit 1;

      if contact_row.owner_id <> p_actor_id then
        raise exception 'manual_prospect_contact_owned_elsewhere';
      end if;
      if contact_row.company_id is distinct from company_row.id then
        raise exception 'manual_prospect_contact_company_conflict';
      end if;
    else
      select count(*)::integer
        into contact_name_matches
      from public.contacts ct
      where ct.workspace_id = p_workspace_id
        and ct.owner_id = p_actor_id
        and ct.company_id = company_row.id
        and lower(regexp_replace(trim(ct.name), '\s+', ' ', 'g')) = lower(contact_name_value);

      if contact_name_matches > 1 then
        raise exception 'manual_prospect_contact_ambiguous';
      elsif contact_name_matches = 1 then
        select ct.*
          into contact_row
        from public.contacts ct
        where ct.workspace_id = p_workspace_id
          and ct.owner_id = p_actor_id
          and ct.company_id = company_row.id
          and lower(regexp_replace(trim(ct.name), '\s+', ' ', 'g')) = lower(contact_name_value)
        limit 1;

        if nullif(lower(trim(coalesce(contact_row.email, ''))), '') is not null
          and lower(trim(contact_row.email)) <> email_value then
          raise exception 'manual_prospect_contact_email_conflict';
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
          p_actor_id,
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
    end if;
  end if;

  if exists (
    select 1
    from public.contacts ct
    where ct.workspace_id = p_workspace_id
      and ct.id <> contact_row.id
      and lower(trim(coalesce(ct.email, ''))) = email_value
      and ct.owner_id <> p_actor_id
  ) then
    raise exception 'manual_prospect_contact_owned_elsewhere';
  end if;
  if exists (
    select 1
    from public.contacts ct
    where ct.workspace_id = p_workspace_id
      and ct.id <> contact_row.id
      and lower(trim(coalesce(ct.email, ''))) = email_value
  ) then
    raise exception 'manual_prospect_contact_ambiguous';
  end if;

  -- A workspace cannot claim an email already used in another workspace. The
  -- existing global unique index enforces this too, but this explicit check
  -- returns a controlled blocker without revealing the other record.
  if exists (
    select 1
    from public.outreach_prospects op
    where lower(trim(op.email)) = email_value
      and op.workspace_id <> p_workspace_id
  ) then
    raise exception 'manual_prospect_duplicate_protected';
  end if;

  select op.*
    into prospect_row
  from public.outreach_prospects op
  where op.workspace_id = p_workspace_id
    and lower(trim(op.email)) = email_value
  limit 1;

  if found then
    if prospect_row.owner_id <> p_actor_id
      and prospect_row.assigned_to_user_id is distinct from p_actor_id
      and not (
        prospect_row.assigned_to_user_id is null
        and prospect_row.visibility = 'team'
      ) then
      raise exception 'manual_prospect_owned_by_teammate';
    end if;
    if prospect_row.crm_company_id is not null
      and prospect_row.crm_company_id <> company_row.id then
      raise exception 'manual_prospect_existing_company_mismatch';
    end if;

    update public.outreach_prospects
    set crm_company_id = company_row.id,
        company_name = company_row.name,
        assigned_to_user_id = coalesce(assigned_to_user_id, p_actor_id),
        first_name = coalesce(nullif(trim(first_name), ''), first_name_value),
        last_name = coalesce(nullif(trim(last_name), ''), nullif(last_name_value, '')),
        job_title = coalesce(nullif(trim(job_title), ''), nullif(job_title_value, '')),
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
      p_actor_id,
      p_workspace_id,
      'private',
      p_actor_id,
      email_value,
      first_name_value,
      nullif(last_name_value, ''),
      nullif(job_title_value, ''),
      company_row.name,
      company_row.id,
      'low',
      'imported',
      'LiveCoach CRM contact',
      'Outreach Prospects',
      jsonb_build_object(
        'manual_entry',
        jsonb_build_object(
          'created_at', now(),
          'created_by', p_actor_id,
          'linked_client_id', company_row.id,
          'linked_contact_id', contact_row.id
        )
      )
    )
    returning * into prospect_row;
    prospect_created := true;
  end if;

  update public.contacts
  set name = contact_name_value,
      email = email_value,
      role = coalesce(nullif(job_title_value, ''), role),
      updated_at = now()
  where id = contact_row.id
    and workspace_id = p_workspace_id
    and owner_id = p_actor_id
    and company_id = company_row.id
  returning * into contact_row;

  return jsonb_build_object(
    'contact', jsonb_build_object(
      'id', contact_row.id,
      'company_id', contact_row.company_id,
      'name', contact_row.name,
      'email', contact_row.email,
      'role', contact_row.role,
      'owner_id', contact_row.owner_id
    ),
    'prospect', jsonb_build_object(
      'id', prospect_row.id,
      'email', prospect_row.email,
      'first_name', prospect_row.first_name,
      'last_name', prospect_row.last_name,
      'job_title', prospect_row.job_title,
      'company_name', prospect_row.company_name,
      'crm_company_id', prospect_row.crm_company_id,
      'assigned_to_user_id', prospect_row.assigned_to_user_id,
      'status', prospect_row.status
    ),
    'contactCreated', contact_created,
    'prospectCreated', prospect_created
  );
end;
$$;

comment on function public.save_owned_client_outreach_contact_server(
  uuid, uuid, uuid, uuid, text, text, text, text
) is 'Service-only atomic writer for one owned CRM sales contact and its email Outreach identity.';

revoke all on function public.save_owned_client_outreach_contact_server(
  uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.save_owned_client_outreach_contact_server(
  uuid, uuid, uuid, uuid, text, text, text, text
) to service_role;
