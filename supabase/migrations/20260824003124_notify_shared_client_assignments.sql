-- Shared client assignments use the same private, per-recipient notification
-- channel as outreach prospects and opportunities. The safe shared company is
-- linked, while private calls, transcripts, email and Brain records remain out
-- of scope.
alter table public.crm_notifications
  drop constraint if exists crm_notifications_source_table_check,
  add constraint crm_notifications_source_table_check check (
    source_table in ('outreach_prospects', 'opportunities', 'companies')
  );

create or replace function livecoach_private.notify_work_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  recipient_id uuid;
  target_uuid uuid;
  current_assignee uuid;
  actor_role text;
  target_label text;
  target_href text;
begin
  if new.action not in (
    'work_assignment_changed',
    'client_sales_assignment_changed',
    'client_sales_access_shared'
  ) then
    return new;
  end if;

  begin
    recipient_id := nullif(new.next_scope ->> 'assignedToUserId', '')::uuid;
    target_uuid := nullif(new.target_id, '')::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  if recipient_id is null or target_uuid is null
    or recipient_id = new.actor_user_id then
    return new;
  end if;

  if new.actor_user_id is not null then
    select wm.role into actor_role
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.actor_user_id
      and wm.status = 'active';
    if actor_role is null or actor_role not in ('owner', 'manager') then
      return new;
    end if;
  end if;

  if new.target_table = 'outreach_prospects' then
    select
      prospect.assigned_to_user_id,
      concat_ws(
        ' · ',
        nullif(trim(concat_ws(' ', prospect.first_name, prospect.last_name)), ''),
        nullif(trim(prospect.company_name), '')
      )
    into current_assignee, target_label
    from public.outreach_prospects prospect
    where prospect.id = target_uuid
      and prospect.workspace_id = new.workspace_id;
    target_href := '/crm/outreach?tab=prospects';
  elsif new.target_table = 'opportunities' then
    select opportunity.assigned_to_user_id, nullif(trim(opportunity.title), '')
    into current_assignee, target_label
    from public.opportunities opportunity
    where opportunity.id = target_uuid
      and opportunity.workspace_id = new.workspace_id;
    target_href := '/crm/revenue';
  elsif new.target_table = 'companies' then
    select share.assigned_to_user_id, nullif(trim(company.name), '')
    into current_assignee, target_label
    from public.team_client_shares share
    join public.companies company
      on company.id = share.company_id
     and company.workspace_id = share.workspace_id
    where share.company_id = target_uuid
      and share.workspace_id = new.workspace_id
      and share.status = 'active';
    target_href := '/crm/' || target_uuid::text;
  else
    return new;
  end if;

  if current_assignee is distinct from recipient_id or not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = recipient_id
      and wm.status = 'active'
  ) then
    return new;
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
    new.workspace_id,
    recipient_id,
    'lead_assigned',
    'New lead assigned to you',
    left(coalesce(target_label, 'A shared sales record is now assigned to you.'), 1000),
    target_href,
    new.target_table,
    target_uuid::text,
    'lead_assignment:' || new.id::text,
    new.created_at
  )
  on conflict (user_id, source_event_key) do nothing;

  return new;
end;
$$;

drop trigger if exists access_audit_notify_work_assignment
  on public.access_audit_events;
create trigger access_audit_notify_work_assignment
  after insert on public.access_audit_events
  for each row
  when (new.action in (
    'work_assignment_changed',
    'client_sales_assignment_changed',
    'client_sales_access_shared'
  ))
  execute function livecoach_private.notify_work_assignment();

revoke execute on function livecoach_private.notify_work_assignment()
  from public, anon, authenticated;
