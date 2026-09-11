-- Research used to be scheduled only by the open browser tab. Persist each
-- requested draft so it survives navigation, refreshes and closed browsers.
-- A leased claim function keeps the per-salesperson concurrency at two even
-- when a user request and the recovery cron overlap.

-- Complete sender setup for active accounts whose verified connector was
-- saved before the profile fields became mandatory. Existing aliases and
-- sender names are preserved.
update public.profiles profile
set outreach_sender_email = coalesce(
      nullif(lower(trim(profile.outreach_sender_email)), ''),
      (
        select nullif(lower(trim(google.email)), '')
        from public.google_oauth google
        where google.owner_id = profile.user_id
          and google.refresh_token is not null
        order by google.updated_at desc
        limit 1
      ),
      (
        select nullif(lower(trim(microsoft.email)), '')
        from public.microsoft_oauth microsoft
        where microsoft.owner_id = profile.user_id
          and microsoft.refresh_token is not null
        order by microsoft.updated_at desc
        limit 1
      )
    ),
    outreach_sender_name = coalesce(
      nullif(trim(profile.outreach_sender_name), ''),
      nullif(trim(profile.display_name), ''),
      split_part(
        coalesce(
          (
            select google.email
            from public.google_oauth google
            where google.owner_id = profile.user_id
              and google.refresh_token is not null
            order by google.updated_at desc
            limit 1
          ),
          (
            select microsoft.email
            from public.microsoft_oauth microsoft
            where microsoft.owner_id = profile.user_id
              and microsoft.refresh_token is not null
            order by microsoft.updated_at desc
            limit 1
          )
        ),
        '@',
        1
      )
    ),
    updated_at = now()
where exists (
    select 1
    from public.workspace_members member
    where member.user_id = profile.user_id
      and member.status = 'active'
  )
  and (
    nullif(trim(profile.outreach_sender_email), '') is null
    or nullif(trim(profile.outreach_sender_name), '') is null
  )
  and (
    exists (
      select 1
      from public.google_oauth google
      where google.owner_id = profile.user_id
        and google.refresh_token is not null
        and nullif(trim(google.email), '') is not null
    )
    or exists (
      select 1
      from public.microsoft_oauth microsoft
      where microsoft.owner_id = profile.user_id
        and microsoft.refresh_token is not null
        and nullif(trim(microsoft.email), '') is not null
    )
  );

create table public.outreach_research_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  prospect_id uuid not null references public.outreach_prospects(id) on delete cascade,
  enrolment_id uuid not null references public.outreach_enrolments(id) on delete cascade,
  message_id uuid references public.outreach_messages(id) on delete set null,
  result_message_id uuid references public.outreach_messages(id) on delete set null,
  step_number integer not null check (step_number between 1 and 10),
  job_kind text not null check (job_kind in ('full_draft', 'voice_script')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  lease_expires_at timestamptz,
  lock_token uuid,
  completed_at timestamptz,
  last_error text,
  last_http_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, enrolment_id, step_number, job_kind)
);

create index outreach_research_jobs_owner_status_available_idx
  on public.outreach_research_jobs (
    workspace_id,
    owner_id,
    status,
    available_at,
    requested_at
  );

create index outreach_research_jobs_running_lease_idx
  on public.outreach_research_jobs (lease_expires_at)
  where status = 'running';

alter table public.outreach_research_jobs enable row level security;

revoke all on public.outreach_research_jobs from public, anon, authenticated;
grant select on public.outreach_research_jobs to authenticated;
grant all on public.outreach_research_jobs to service_role;

create policy "Members read their own outreach research jobs"
  on public.outreach_research_jobs for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_research_jobs.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Service role manages outreach research jobs"
  on public.outreach_research_jobs for all to service_role
  using (true)
  with check (true);

create or replace function public.enqueue_outreach_research_jobs(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_jobs jsonb
)
returns setof public.outreach_research_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is distinct from p_owner_id then
    raise exception 'research jobs can only be queued for the signed in user';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_owner_id
      and wm.status = 'active'
  ) then
    raise exception 'an active workspace membership is required';
  end if;

  if jsonb_typeof(coalesce(p_jobs, '[]'::jsonb)) <> 'array' then
    raise exception 'research jobs must be an array';
  end if;

  if jsonb_array_length(coalesce(p_jobs, '[]'::jsonb)) > 50 then
    raise exception 'no more than 50 research jobs can be queued at once';
  end if;

  return query
  with requested as (
    select distinct
      input.prospect_id,
      input.enrolment_id,
      input.message_id,
      input.step_number,
      input.job_kind
    from jsonb_to_recordset(coalesce(p_jobs, '[]'::jsonb)) as input(
      prospect_id uuid,
      enrolment_id uuid,
      message_id uuid,
      step_number integer,
      job_kind text
    )
    where input.job_kind in ('full_draft', 'voice_script')
      and input.step_number between 1 and 10
  ),
  valid as (
    select requested.*
    from requested
    join public.outreach_prospects prospect
      on prospect.id = requested.prospect_id
     and prospect.workspace_id = p_workspace_id
     and prospect.assigned_to_user_id = p_owner_id
    join public.outreach_enrolments enrolment
      on enrolment.id = requested.enrolment_id
     and enrolment.workspace_id = p_workspace_id
     and enrolment.prospect_id = requested.prospect_id
     and enrolment.current_step = requested.step_number
     and enrolment.queued_for = timezone('Europe/London', now())::date
     and enrolment.status in ('queued', 'researched', 'drafted')
    join public.outreach_campaigns campaign
      on campaign.id = enrolment.campaign_id
     and campaign.workspace_id = p_workspace_id
     and campaign.status = 'active'
    left join public.outreach_messages message
      on message.id = requested.message_id
     and message.workspace_id = p_workspace_id
     and message.sender_user_id = p_owner_id
     and message.enrolment_id = requested.enrolment_id
     and message.prospect_id = requested.prospect_id
     and message.step_number = requested.step_number
    where (
      requested.job_kind = 'full_draft'
      and requested.message_id is null
      and not exists (
        select 1
        from public.outreach_messages existing_message
        where existing_message.workspace_id = p_workspace_id
          and existing_message.enrolment_id = requested.enrolment_id
          and existing_message.step_number = requested.step_number
      )
    ) or (
      requested.job_kind = 'voice_script'
      and message.id is not null
      and message.status in ('draft', 'failed')
      and nullif(trim(message.voice_script), '') is null
    )
  ),
  saved as (
    insert into public.outreach_research_jobs (
      workspace_id,
      owner_id,
      prospect_id,
      enrolment_id,
      message_id,
      step_number,
      job_kind,
      status,
      attempt_count,
      max_attempts,
      available_at,
      requested_at,
      started_at,
      lease_expires_at,
      lock_token,
      completed_at,
      result_message_id,
      last_error,
      last_http_status,
      updated_at
    )
    select
      p_workspace_id,
      p_owner_id,
      valid.prospect_id,
      valid.enrolment_id,
      valid.message_id,
      valid.step_number,
      valid.job_kind,
      'queued',
      0,
      3,
      now(),
      now(),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      now()
    from valid
    on conflict (workspace_id, owner_id, enrolment_id, step_number, job_kind)
    do update set
      prospect_id = excluded.prospect_id,
      message_id = excluded.message_id,
      status = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.status
        else 'queued'
      end,
      attempt_count = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.attempt_count
        else 0
      end,
      max_attempts = 3,
      available_at = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.available_at
        else now()
      end,
      requested_at = now(),
      started_at = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.started_at
        else null
      end,
      lease_expires_at = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.lease_expires_at
        else null
      end,
      lock_token = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.lock_token
        else null
      end,
      completed_at = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.completed_at
        else null
      end,
      result_message_id = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.result_message_id
        else null
      end,
      last_error = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.last_error
        else null
      end,
      last_http_status = case
        when outreach_research_jobs.status = 'running'
         and outreach_research_jobs.lease_expires_at > now()
          then outreach_research_jobs.last_http_status
        else null
      end,
      updated_at = now()
    returning outreach_research_jobs.*
  )
  select * from saved;
end;
$$;

revoke execute on function public.enqueue_outreach_research_jobs(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.enqueue_outreach_research_jobs(uuid, uuid, jsonb)
  to authenticated;

create or replace function public.claim_outreach_research_jobs(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_lock_token uuid,
  p_limit integer default 2
)
returns setof public.outreach_research_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_count integer;
  claim_limit integer;
begin
  if p_workspace_id is null or p_owner_id is null or p_lock_token is null then
    raise exception 'an exact account and lock token are required';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_owner_id
      and wm.status = 'active'
  ) then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_owner_id::text, 0)
  );

  update public.outreach_research_jobs
  set status = 'failed',
      completed_at = now(),
      lease_expires_at = null,
      lock_token = null,
      last_error = coalesce(last_error, 'Research stopped after three unsuccessful attempts.'),
      updated_at = now()
  where workspace_id = p_workspace_id
    and owner_id = p_owner_id
    and status in ('queued', 'running')
    and attempt_count >= max_attempts
    and (status = 'queued' or lease_expires_at is null or lease_expires_at <= now());

  update public.outreach_research_jobs
  set status = 'queued',
      available_at = now(),
      lease_expires_at = null,
      lock_token = null,
      last_error = coalesce(last_error, 'The previous worker stopped before confirming completion. Retrying safely.'),
      updated_at = now()
  where workspace_id = p_workspace_id
    and owner_id = p_owner_id
    and status = 'running'
    and attempt_count < max_attempts
    and (lease_expires_at is null or lease_expires_at <= now());

  select count(*)::integer
  into active_count
  from public.outreach_research_jobs
  where workspace_id = p_workspace_id
    and owner_id = p_owner_id
    and status = 'running'
    and lease_expires_at > now();

  claim_limit := greatest(0, least(2, coalesce(p_limit, 2)) - active_count);
  if claim_limit = 0 then
    return;
  end if;

  return query
  with candidates as (
    select job.id
    from public.outreach_research_jobs job
    where job.workspace_id = p_workspace_id
      and job.owner_id = p_owner_id
      and job.status = 'queued'
      and job.attempt_count < job.max_attempts
      and job.available_at <= now()
    order by job.requested_at, job.created_at, job.id
    for update skip locked
    limit claim_limit
  )
  update public.outreach_research_jobs job
  set status = 'running',
      attempt_count = job.attempt_count + 1,
      started_at = now(),
      lease_expires_at = now() + interval '120 seconds',
      lock_token = p_lock_token,
      completed_at = null,
      updated_at = now()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

revoke execute on function public.claim_outreach_research_jobs(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_outreach_research_jobs(uuid, uuid, uuid, integer)
  to service_role;

comment on table public.outreach_research_jobs is
  'Durable per-salesperson research and draft work. Leases prevent more than two concurrent paid research operations for one salesperson.';

comment on function public.enqueue_outreach_research_jobs(uuid, uuid, jsonb) is
  'Queues up to 50 exact, currently assigned outreach items for the signed in salesperson without duplicating active work.';

comment on function public.claim_outreach_research_jobs(uuid, uuid, uuid, integer) is
  'Claims no more than two leased research jobs for one exact active workspace account and safely recovers expired work.';
