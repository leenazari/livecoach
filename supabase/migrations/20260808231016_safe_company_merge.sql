-- A duplicate client merge must either move every linked record or move none.
-- Keep the destructive operation inside Postgres so a partial network failure
-- can never leave the CRM split across two clients.

create table if not exists public.crm_company_redirects (
  source_id uuid primary key,
  target_id uuid not null references public.companies(id) on delete cascade,
  source_name text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  moved_counts jsonb not null default '{}'::jsonb,
  merged_at timestamptz not null default now(),
  constraint crm_company_redirects_distinct_ids check (source_id <> target_id)
);

create index if not exists crm_company_redirects_target_idx
  on public.crm_company_redirects(target_id);

alter table public.crm_company_redirects enable row level security;
revoke all on table public.crm_company_redirects from public, anon, authenticated;
grant select, insert, update, delete on table public.crm_company_redirects to service_role;

create or replace function public.merge_crm_companies(
  p_keep_id uuid,
  p_merge_id uuid,
  p_expected_keep_updated_at timestamptz,
  p_expected_merge_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep public.companies%rowtype;
  v_merge public.companies%rowtype;
  v_keep_name_key text;
  v_merge_name_key text;
  v_keep_domain_key text;
  v_merge_domain_key text;
  v_priority integer;
  v_counts jsonb;
begin
  if p_keep_id is null or p_merge_id is null or p_keep_id = p_merge_id then
    raise exception 'Choose two different client records';
  end if;

  -- Lock in a stable order so simultaneous merge attempts cannot deadlock.
  perform id
  from public.companies
  where id in (p_keep_id, p_merge_id)
  order by id
  for update;

  select * into v_keep from public.companies where id = p_keep_id;
  select * into v_merge from public.companies where id = p_merge_id;
  if not found or v_keep.id is null or v_merge.id is null then
    raise exception 'One of these client records no longer exists';
  end if;

  if v_keep.updated_at is distinct from p_expected_keep_updated_at
     or v_merge.updated_at is distinct from p_expected_merge_updated_at then
    raise exception 'One of these clients changed after the review. Refresh and review again.';
  end if;

  v_keep_name_key := regexp_replace(
    regexp_replace(lower(coalesce(v_keep.name, '')), '\m(limited|ltd|incorporated|inc|llc|plc|company|co)\M', '', 'g'),
    '[^a-z0-9]', '', 'g'
  );
  v_merge_name_key := regexp_replace(
    regexp_replace(lower(coalesce(v_merge.name, '')), '\m(limited|ltd|incorporated|inc|llc|plc|company|co)\M', '', 'g'),
    '[^a-z0-9]', '', 'g'
  );
  v_keep_domain_key := regexp_replace(
    regexp_replace(lower(coalesce(nullif(v_keep.domain, ''), v_keep.website, '')), '^https?://(www\.)?', ''),
    '/.*$', ''
  );
  v_merge_domain_key := regexp_replace(
    regexp_replace(lower(coalesce(nullif(v_merge.domain, ''), v_merge.website, '')), '^https?://(www\.)?', ''),
    '/.*$', ''
  );

  if not (
    (length(v_keep_name_key) >= 4 and v_keep_name_key = v_merge_name_key)
    or (v_keep_domain_key <> '' and v_keep_domain_key = v_merge_domain_key)
    or exists (
      select 1
      from public.contacts keep_contact
      join public.contacts merge_contact
        on lower(trim(keep_contact.email)) = lower(trim(merge_contact.email))
      where keep_contact.company_id = p_keep_id
        and merge_contact.company_id = p_merge_id
        and nullif(trim(keep_contact.email), '') is not null
    )
  ) then
    raise exception 'These records no longer meet the safe duplicate rules';
  end if;

  select jsonb_build_object(
    'contacts', (select count(*) from public.contacts where company_id = p_merge_id),
    'calls', (select count(*) from public.interview_sessions where company_id = p_merge_id),
    'summaries', (select count(*) from public.interview_summaries where company_id = p_merge_id),
    'opportunities', (select count(*) from public.opportunities where company_id = p_merge_id),
    'followUps', (select count(*) from public.follow_ups where company_id = p_merge_id),
    'tasks', (select count(*) from public.tasks where company_id = p_merge_id),
    'context', (select count(*) from public.client_context where company_id = p_merge_id),
    'brainMessages', (select count(*) from public.assistant_messages where company_id = p_merge_id),
    'upcomingCalls', (select count(*) from public.upcoming_calls where company_id = p_merge_id),
    'outreach', (select count(*) from public.outreach_prospects where crm_company_id = p_merge_id),
    'emailLinks', (select count(*) from public.contact_company_overrides where company_id = p_merge_id),
    'externalRefs', (select count(*) from public.external_refs where entity_type = 'company' and entity_id = p_merge_id),
    'prioritySetting', (select count(*) from public.company_priority where company_id = p_merge_id)
  ) into v_counts;

  -- Keep the selected client's identity and any populated values. Fill its
  -- blanks from the duplicate, while retaining both JSON memories and notes.
  update public.companies
  set
    owner_id = coalesce(v_keep.owner_id, v_merge.owner_id),
    domain = coalesce(nullif(trim(v_keep.domain), ''), v_merge.domain),
    website = coalesce(nullif(trim(v_keep.website), ''), v_merge.website),
    sector = coalesce(nullif(trim(v_keep.sector), ''), v_merge.sector),
    stage = coalesce(nullif(trim(v_keep.stage), ''), v_merge.stage),
    profile = coalesce(v_merge.profile, '{}'::jsonb) || coalesce(v_keep.profile, '{}'::jsonb),
    attributes = coalesce(v_merge.attributes, '{}'::jsonb) || coalesce(v_keep.attributes, '{}'::jsonb),
    notes = case
      when nullif(trim(v_keep.notes), '') is null then v_merge.notes
      when nullif(trim(v_merge.notes), '') is null or trim(v_keep.notes) = trim(v_merge.notes) then v_keep.notes
      else v_keep.notes || E'\n\nMerged from ' || v_merge.name || E':\n' || v_merge.notes
    end,
    email_context = case
      when nullif(trim(v_keep.email_context), '') is null then v_merge.email_context
      when nullif(trim(v_merge.email_context), '') is null or trim(v_keep.email_context) = trim(v_merge.email_context) then v_keep.email_context
      else v_keep.email_context || E'\n\nMerged from ' || v_merge.name || E':\n' || v_merge.email_context
    end,
    email_context_updated_at = greatest(v_keep.email_context_updated_at, v_merge.email_context_updated_at),
    commercial_memory = coalesce(v_merge.commercial_memory, '{}'::jsonb) || coalesce(v_keep.commercial_memory, '{}'::jsonb),
    commercial_memory_updated_at = greatest(v_keep.commercial_memory_updated_at, v_merge.commercial_memory_updated_at),
    created_at = least(v_keep.created_at, v_merge.created_at),
    updated_at = now()
  where id = p_keep_id;

  -- company_priority is one-row-per-client, so combine it separately.
  select min(position) into v_priority
  from public.company_priority
  where company_id in (p_keep_id, p_merge_id);
  delete from public.company_priority where company_id in (p_keep_id, p_merge_id);
  if v_priority is not null then
    insert into public.company_priority(company_id, position, updated_at)
    values (p_keep_id, v_priority, now());
  end if;

  update public.contacts set company_id = p_keep_id where company_id = p_merge_id;
  update public.interview_sessions set company_id = p_keep_id where company_id = p_merge_id;
  update public.interview_summaries set company_id = p_keep_id where company_id = p_merge_id;
  update public.opportunities set company_id = p_keep_id where company_id = p_merge_id;
  update public.follow_ups set company_id = p_keep_id where company_id = p_merge_id;
  update public.assistant_messages set company_id = p_keep_id where company_id = p_merge_id;
  update public.client_context set company_id = p_keep_id where company_id = p_merge_id;
  update public.upcoming_calls set company_id = p_keep_id where company_id = p_merge_id;
  update public.tasks set company_id = p_keep_id where company_id = p_merge_id;
  update public.contact_company_overrides set company_id = p_keep_id where company_id = p_merge_id;
  update public.outreach_prospects set crm_company_id = p_keep_id where crm_company_id = p_merge_id;
  update public.external_refs set entity_id = p_keep_id
    where entity_type = 'company' and entity_id = p_merge_id;

  -- Preserve earlier redirects if a previously-surviving record is merged
  -- again, then record this source ID before removing the duplicate.
  update public.crm_company_redirects
  set target_id = p_keep_id, merged_at = now()
  where target_id = p_merge_id;
  insert into public.crm_company_redirects(
    source_id, target_id, source_name, source_snapshot, moved_counts, merged_at
  )
  values (p_merge_id, p_keep_id, v_merge.name, to_jsonb(v_merge), v_counts, now())
  on conflict (source_id) do update
    set target_id = excluded.target_id,
        source_name = excluded.source_name,
        source_snapshot = excluded.source_snapshot,
        moved_counts = excluded.moved_counts,
        merged_at = excluded.merged_at;

  delete from public.companies where id = p_merge_id;

  return jsonb_build_object(
    'keepId', p_keep_id,
    'mergedId', p_merge_id,
    'keepName', v_keep.name,
    'mergedName', v_merge.name,
    'moved', v_counts
  );
end;
$$;

revoke all on function public.merge_crm_companies(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.merge_crm_companies(uuid, uuid, timestamptz, timestamptz)
  to service_role;
