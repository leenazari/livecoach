-- Messy source lists are reviewed before they can affect Outreach. Only the
-- active workspace owner may see a batch. Applying and undoing happen through
-- server-only, workspace-bound functions so retries cannot duplicate rows.

create table public.crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  source_name text not null check (length(source_name) between 1 and 240),
  status text not null default 'staged' check (
    status in ('staged', 'applied', 'undone', 'cancelled', 'failed')
  ),
  row_count integer not null default 0 check (row_count between 0 and 500),
  ready_count integer not null default 0 check (ready_count between 0 and 500),
  duplicate_count integer not null default 0 check (duplicate_count between 0 and 500),
  review_count integer not null default 0 check (review_count between 0 and 500),
  invalid_count integer not null default 0 check (invalid_count between 0 and 500),
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  applied_result jsonb not null default '{}'::jsonb check (jsonb_typeof(applied_result) = 'object'),
  applied_at timestamptz,
  undone_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_import_batches_owner_created_idx
  on public.crm_import_batches (workspace_id, owner_id, created_at desc);
create index crm_import_batches_assignee_fk_idx
  on public.crm_import_batches (assigned_to_user_id);

create trigger crm_import_batches_touch_updated_at
  before update on public.crm_import_batches
  for each row execute function public.brain_touch_updated_at();

alter table public.crm_import_batches enable row level security;
revoke all on public.crm_import_batches from public, anon, authenticated;
grant select on public.crm_import_batches to authenticated;
grant all on public.crm_import_batches to service_role;

create policy "Owner reads private import batches"
  on public.crm_import_batches for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = crm_import_batches.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.role = 'owner'
        and wm.status = 'active'
    )
  );

create or replace function public.apply_outreach_import_batch_service(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  batch public.crm_import_batches%rowtype;
  item jsonb;
  inserted_id uuid;
  inserted_ids jsonb := '[]'::jsonb;
  inserted_count integer := 0;
  skipped_count integer := 0;
  row_status text;
  result jsonb;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_user_id
      and wm.role = 'owner'
      and wm.status = 'active'
  ) then
    raise exception 'workspace owner access is required';
  end if;

  select * into batch
  from public.crm_import_batches b
  where b.id = p_batch_id
    and b.workspace_id = p_workspace_id
    and b.owner_id = p_actor_user_id
  for update;
  if batch.id is null then raise exception 'import batch not found'; end if;
  if batch.status = 'applied' then return batch.applied_result; end if;
  if batch.status <> 'staged' then
    raise exception 'this import batch is no longer available to apply';
  end if;
  if batch.expires_at <= now() then raise exception 'this import batch has expired'; end if;
  if batch.assigned_to_user_id is not null and not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = batch.assigned_to_user_id
      and wm.status = 'active'
  ) then
    raise exception 'the selected assignee is no longer an active workspace member';
  end if;

  for item in select value from jsonb_array_elements(batch.rows)
  loop
    if item->>'decision' <> 'ready' then continue; end if;
    if coalesce(item->>'email', '') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
       or nullif(trim(item->>'companyName'), '') is null then
      skipped_count := skipped_count + 1;
      continue;
    end if;
    row_status := case when item->>'importStatus' in (
      'imported', 'contacted', 'replied', 'qualified', 'not_interested', 'suppressed'
    ) then item->>'importStatus' else 'imported' end;
    inserted_id := null;
    insert into public.outreach_prospects (
      owner_id, workspace_id, visibility, assigned_to_user_id,
      email, first_name, last_name, job_title, company_name, company_domain,
      website, industry, phone, person_linkedin_url, company_linkedin_url,
      status, suppression_reason, source_file, source_row, source_metadata
    ) values (
      p_actor_user_id, p_workspace_id, 'team', batch.assigned_to_user_id,
      lower(trim(item->>'email')), nullif(trim(item->>'firstName'), ''),
      nullif(trim(item->>'lastName'), ''), nullif(trim(item->>'jobTitle'), ''),
      trim(item->>'companyName'), nullif(trim(item->>'companyDomain'), ''),
      nullif(trim(item->>'website'), ''), nullif(trim(item->>'industry'), ''),
      nullif(trim(item->>'phone'), ''), nullif(trim(item->>'personLinkedinUrl'), ''),
      nullif(trim(item->>'companyLinkedinUrl'), ''), row_status,
      case when row_status = 'suppressed' then
        'Imported source status, ' || coalesce(nullif(trim(item->>'sourceStatus'), ''), 'do not contact')
      else null end,
      batch.source_name, nullif(item->>'rowNumber', '')::integer,
      jsonb_build_object(
        'importBatchId', batch.id,
        'sourceStatus', item->>'sourceStatus',
        'importedByUserId', p_actor_user_id
      )
    )
    on conflict do nothing
    returning id into inserted_id;
    if inserted_id is null then
      skipped_count := skipped_count + 1;
    else
      inserted_count := inserted_count + 1;
      inserted_ids := inserted_ids || jsonb_build_array(inserted_id);
    end if;
  end loop;

  result := jsonb_build_object(
    'batchId', batch.id,
    'inserted', inserted_count,
    'skippedAtApply', skipped_count,
    'insertedIds', inserted_ids,
    'appliedAt', now(),
    'undoUntil', now() + interval '10 minutes'
  );
  update public.crm_import_batches
  set status = 'applied', applied_result = result, applied_at = now()
  where id = batch.id;
  return result;
end;
$$;

create or replace function public.undo_outreach_import_batch_service(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  batch public.crm_import_batches%rowtype;
  removed_count integer := 0;
  result jsonb;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_user_id
      and wm.role = 'owner'
      and wm.status = 'active'
  ) then
    raise exception 'workspace owner access is required';
  end if;
  select * into batch
  from public.crm_import_batches b
  where b.id = p_batch_id
    and b.workspace_id = p_workspace_id
    and b.owner_id = p_actor_user_id
  for update;
  if batch.id is null then raise exception 'import batch not found'; end if;
  if batch.status = 'undone' then return batch.applied_result; end if;
  if batch.status <> 'applied' then raise exception 'only an applied batch can be undone'; end if;
  if batch.applied_at < now() - interval '10 minutes' then
    raise exception 'the ten minute undo window has closed';
  end if;

  with removed as (
    delete from public.outreach_prospects prospect
    where prospect.workspace_id = p_workspace_id
      and prospect.owner_id = p_actor_user_id
      and prospect.id in (
        select (value #>> '{}')::uuid
        from jsonb_array_elements(
          coalesce(batch.applied_result->'insertedIds', '[]'::jsonb)
        )
      )
      and prospect.status in ('imported', 'not_interested', 'suppressed')
      and prospect.last_researched_at is null
      and prospect.last_contacted_at is null
      and prospect.last_reply_at is null
      and (prospect.research is null or prospect.research = '{}'::jsonb)
      and not exists (select 1 from public.outreach_enrolments e where e.prospect_id = prospect.id)
      and not exists (select 1 from public.outreach_messages m where m.prospect_id = prospect.id)
      and not exists (select 1 from public.outreach_events ev where ev.prospect_id = prospect.id)
    returning id
  ) select count(*) into removed_count from removed;

  result := batch.applied_result || jsonb_build_object(
    'undoneAt', now(),
    'removed', removed_count,
    'protected', greatest(
      0,
      jsonb_array_length(coalesce(batch.applied_result->'insertedIds', '[]'::jsonb)) - removed_count
    )
  );
  update public.crm_import_batches
  set status = 'undone', applied_result = result, undone_at = now()
  where id = batch.id;
  return result;
end;
$$;

revoke all on function public.apply_outreach_import_batch_service(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.undo_outreach_import_batch_service(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_outreach_import_batch_service(uuid, uuid, uuid)
  to service_role;
grant execute on function public.undo_outreach_import_batch_service(uuid, uuid, uuid)
  to service_role;

comment on table public.crm_import_batches is
  'Owner-private staged Outreach imports. Rejected and duplicate rows never become live prospects.';
