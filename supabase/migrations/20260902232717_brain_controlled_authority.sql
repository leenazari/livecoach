-- Brain actions are issued by the server, confirmed by the signed-in person,
-- and executed through one audited gate. The browser can read permitted audit
-- rows but can never create or rewrite them.

create table public.brain_action_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_role text not null check (actor_role in ('owner', 'manager', 'sales')),
  action_type text not null check (length(action_type) between 1 and 100),
  action_kind text not null check (action_kind in (
    'read_and_analyse',
    'create_internal_draft',
    'update_internal_crm',
    'customer_communication',
    'paid_generation',
    'destructive_action',
    'shared_learning'
  )),
  label text not null default '' check (length(label) <= 1000),
  target_endpoint text not null check (
    target_endpoint like '/api/crm/%'
    and length(target_endpoint) <= 500
  ),
  request_method text not null check (request_method in ('POST', 'PATCH', 'DELETE')),
  status text not null default 'running' check (status in (
    'running', 'completed', 'failed', 'blocked'
  )),
  policy_decision text not null check (policy_decision in (
    'confirmed', 'owner_override', 'blocked'
  )),
  owner_override_requested boolean not null default false,
  owner_override_applied boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 240),
  attempt_count integer not null default 1 check (attempt_count between 1 and 20),
  request_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_payload) = 'object'),
  before_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(before_state) = 'object'),
  response_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(response_payload) = 'object'),
  recovery jsonb not null default '{}'::jsonb
    check (jsonb_typeof(recovery) = 'object'),
  blocker_code text check (blocker_code is null or length(blocker_code) <= 160),
  error text check (error is null or length(error) <= 2000),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  undo_started_at timestamptz,
  undone_at timestamptz,
  undo_response jsonb not null default '{}'::jsonb
    check (jsonb_typeof(undo_response) = 'object'),
  estimated_cost_gbp numeric(12,6) not null default 0
    check (estimated_cost_gbp >= 0),
  actual_cost_gbp numeric(12,6) not null default 0
    check (actual_cost_gbp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, actor_user_id, idempotency_key)
);

create index brain_action_executions_actor_created_idx
  on public.brain_action_executions (workspace_id, actor_user_id, created_at desc);
create index brain_action_executions_workspace_status_idx
  on public.brain_action_executions (workspace_id, status, updated_at desc);
create index brain_action_executions_actor_fk_idx
  on public.brain_action_executions (actor_user_id);

create trigger brain_action_executions_touch_updated_at
  before update on public.brain_action_executions
  for each row execute function public.brain_touch_updated_at();

alter table public.brain_action_executions enable row level security;

revoke all on public.brain_action_executions from public, anon, authenticated;
grant select on public.brain_action_executions to authenticated;
grant all on public.brain_action_executions to service_role;

create policy "Members read permitted Brain executions"
  on public.brain_action_executions for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = brain_action_executions.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          brain_action_executions.actor_user_id = (select auth.uid())
          or wm.role = 'owner'
        )
    )
  );

create policy "No browser inserts to Brain executions"
  on public.brain_action_executions for insert to authenticated
  with check (false);
create policy "No browser updates to Brain executions"
  on public.brain_action_executions for update to authenticated
  using (false)
  with check (false);
create policy "No browser deletes from Brain executions"
  on public.brain_action_executions for delete to authenticated
  using (false);

-- A member may see their own rule. The active workspace owner may see and
-- govern every member's rules. Staff can never alter their own authority.
drop policy if exists "Owners manage Brain trust rules"
  on public.brain_trust_rules;

create policy "Members read permitted Brain trust rules"
  on public.brain_trust_rules for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = brain_trust_rules.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          brain_trust_rules.owner_id = (select auth.uid())
          or wm.role = 'owner'
        )
    )
  );

create policy "Workspace owner inserts Brain trust rules"
  on public.brain_trust_rules for insert to authenticated
  with check (
    exists (
      select 1
      from public.workspace_members actor
      join public.workspace_members target
        on target.workspace_id = actor.workspace_id
       and target.user_id = brain_trust_rules.owner_id
       and target.status = 'active'
      where actor.workspace_id = brain_trust_rules.workspace_id
        and actor.user_id = (select auth.uid())
        and actor.status = 'active'
        and actor.role = 'owner'
    )
  );

create policy "Workspace owner updates Brain trust rules"
  on public.brain_trust_rules for update to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = brain_trust_rules.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members actor
      join public.workspace_members target
        on target.workspace_id = actor.workspace_id
       and target.user_id = brain_trust_rules.owner_id
       and target.status = 'active'
      where actor.workspace_id = brain_trust_rules.workspace_id
        and actor.user_id = (select auth.uid())
        and actor.status = 'active'
        and actor.role = 'owner'
    )
  );

create policy "Workspace owner deletes Brain trust rules"
  on public.brain_trust_rules for delete to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = brain_trust_rules.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  );

-- Delegate a private task without exposing its source row. A call remains
-- attached to the owner's calendar connector and becomes a normal dated call
-- task in the assignee's private list. This is one atomic and idempotent write.
alter table public.crm_notifications
  drop constraint if exists crm_notifications_kind_check,
  add constraint crm_notifications_kind_check check (
    kind in (
      'outreach_reply', 'important_email', 'lead_assigned', 'chat_message',
      'work_assigned'
    )
  ),
  drop constraint if exists crm_notifications_source_table_check,
  add constraint crm_notifications_source_table_check check (
    source_table in (
      'outreach_prospects', 'opportunities', 'companies', 'crm_chat_messages',
      'tasks'
    )
  );

create or replace function public.delegate_brain_work_service(
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
  actor_workspace_id uuid;
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

  select wm.workspace_id into actor_workspace_id
  from public.workspace_members wm
  where wm.user_id = p_actor_user_id
    and wm.role = 'owner'
    and wm.status = 'active'
  limit 1;
  if actor_workspace_id is null then
    raise exception 'workspace owner access is required';
  end if;
  if p_assigned_to_user_id = p_actor_user_id or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = actor_workspace_id
      and wm.user_id = p_assigned_to_user_id
      and wm.status = 'active'
  ) then
    raise exception 'choose another active workspace member';
  end if;

  if p_kind = 'task' then
    select * into source_task
    from public.tasks task
    where task.id = p_record_id
      and task.workspace_id = actor_workspace_id
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
      and call.workspace_id = actor_workspace_id
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
    select 1 from public.team_client_shares share
    where share.workspace_id = actor_workspace_id
      and share.company_id = source_company_id
      and share.assigned_to_user_id = p_assigned_to_user_id
      and share.status = 'active'
  ) then
    raise exception 'assign the linked client to that salesperson first';
  end if;

  target_fingerprint := md5(
    p_assigned_to_user_id::text || '::' || source_reference
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
    actor_workspace_id,
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
      and workspace_id = actor_workspace_id
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
    actor_workspace_id,
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

revoke all on function public.delegate_brain_work_service(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delegate_brain_work_service(uuid, text, uuid, uuid)
  to service_role;

comment on function public.delegate_brain_work_service(uuid, text, uuid, uuid) is
  'Server-only owner delegation. Transfers a task or creates a private call task without transferring calendar credentials or private source records.';
