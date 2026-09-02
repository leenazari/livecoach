-- Bind owner delegation to the exact workspace selected by the request. An
-- owner may belong to more than one workspace, so the database function must
-- never infer a workspace from the actor alone.

drop function if exists public.delegate_brain_work_service(uuid, text, uuid, uuid);

create function public.delegate_brain_work_service(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_kind text,
  p_record_id uuid,
  p_assigned_to_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_task public.tasks%rowtype;
  source_call public.upcoming_calls%rowtype;
  source_company_id uuid;
  target_id uuid;
  target_text text;
  target_due_at timestamptz;
  target_link_kind text;
  target_fingerprint text;
  source_reference text;
begin
  if p_kind not in ('task', 'call') then
    raise exception 'choose a task or call to delegate';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_user_id
      and wm.role = 'owner'
      and wm.status = 'active'
  ) then
    raise exception 'workspace owner access is required';
  end if;
  if p_assigned_to_user_id = p_actor_user_id or not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_assigned_to_user_id
      and wm.status = 'active'
  ) then
    raise exception 'choose another active workspace member';
  end if;

  if p_kind = 'task' then
    select * into source_task
    from public.tasks task
    where task.id = p_record_id
      and task.workspace_id = p_workspace_id
      and task.owner_id = p_actor_user_id;
    if source_task.id is null then
      raise exception 'task not found in the owner account';
    end if;
    if source_task.status = 'done' then
      raise exception 'the task is already complete';
    end if;
    source_company_id := source_task.company_id;
    target_text := source_task.text;
    target_due_at := source_task.due_at;
    target_link_kind := source_task.link_kind;
    source_reference := 'delegated_task:' || source_task.id::text;
  else
    select * into source_call
    from public.upcoming_calls call
    where call.id = p_record_id
      and call.workspace_id = p_workspace_id
      and call.owner_id = p_actor_user_id;
    if source_call.id is null then
      raise exception 'call not found in the owner account';
    end if;
    if source_call.completed_at is not null then
      raise exception 'the call is already complete';
    end if;
    source_company_id := source_call.company_id;
    target_text := 'Handle call, ' || coalesce(nullif(trim(source_call.title), ''), 'client call');
    target_due_at := source_call.scheduled_at;
    target_link_kind := 'call';
    source_reference := 'delegated_call:' || source_call.id::text;
  end if;

  if source_company_id is not null and not exists (
    select 1
    from public.team_client_shares share
    where share.workspace_id = p_workspace_id
      and share.company_id = source_company_id
      and share.assigned_to_user_id = p_assigned_to_user_id
      and share.status = 'active'
  ) then
    raise exception 'assign the linked client to that salesperson first';
  end if;

  target_fingerprint := md5(
    p_workspace_id::text || '::' || p_assigned_to_user_id::text || '::' || source_reference
  );

  insert into public.tasks (
    company_id,
    workstream_id,
    text,
    kind,
    link_kind,
    source,
    source_ref,
    payload,
    due_at,
    fingerprint,
    status,
    workspace_id,
    owner_id,
    visibility
  ) values (
    source_company_id,
    null,
    target_text,
    'delegated',
    target_link_kind,
    'brain_delegation',
    source_reference,
    jsonb_build_object(
      'delegatedByUserId', p_actor_user_id,
      'sourceKind', p_kind,
      'scheduledTime', target_due_at is not null,
      'pinned', true
    ),
    target_due_at,
    target_fingerprint,
    'open',
    p_workspace_id,
    p_assigned_to_user_id,
    'private'
  )
  on conflict (owner_id, fingerprint) do update
    set text = excluded.text,
        company_id = excluded.company_id,
        link_kind = excluded.link_kind,
        due_at = excluded.due_at,
        payload = excluded.payload
  returning id into target_id;

  if p_kind = 'task' then
    update public.tasks
    set status = 'dismissed',
        payload = coalesce(source_task.payload, '{}'::jsonb) || jsonb_build_object(
          'delegatedToUserId', p_assigned_to_user_id,
          'delegatedTaskId', target_id,
          'delegatedAt', now()
        )
    where id = source_task.id
      and workspace_id = p_workspace_id
      and owner_id = p_actor_user_id;
  end if;

  insert into public.crm_notifications (
    workspace_id,
    user_id,
    kind,
    title,
    body,
    href,
    source_table,
    source_id,
    source_event_key,
    created_at
  ) values (
    p_workspace_id,
    p_assigned_to_user_id,
    'work_assigned',
    case when p_kind = 'call' then 'New call assigned to you'
      else 'New task assigned to you' end,
    left(target_text, 1000),
    case when p_kind = 'call' then '/crm/calls' else '/crm/tasks' end,
    'tasks',
    target_id::text,
    'brain_work_assignment:' || target_id::text,
    now()
  )
  on conflict (user_id, source_event_key) do nothing;

  return jsonb_build_object(
    'kind', p_kind,
    'sourceRecordId', p_record_id,
    'assignedToUserId', p_assigned_to_user_id,
    'taskId', target_id,
    'dueAt', target_due_at,
    'sourceClosed', p_kind = 'task'
  );
end;
$$;

revoke all on function public.delegate_brain_work_service(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delegate_brain_work_service(uuid, uuid, text, uuid, uuid)
  to service_role;

comment on function public.delegate_brain_work_service(uuid, uuid, text, uuid, uuid) is
  'Server-only owner delegation bound to one exact workspace. Transfers a task or creates a private call task without transferring calendar credentials or private source records.';
