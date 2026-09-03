-- Fresh team prospect imports can remain unassigned until a salesperson claims
-- them. Opportunities keep their existing owner-on-insert behaviour and an
-- outreach message still requires an explicit sender.
create or replace function public.validate_livecoach_work_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  assignee_id uuid;
begin
  if tg_table_name = 'outreach_messages' then
    assignee_id := nullif(to_jsonb(new)->>'sender_user_id', '')::uuid;
  else
    assignee_id := nullif(to_jsonb(new)->>'assigned_to_user_id', '')::uuid;
  end if;

  if assignee_id is null then
    if tg_table_name = 'outreach_messages' then
      raise exception 'an outreach sender is required';
    end if;

    -- A team-visible outreach prospect with no assignee is the canonical
    -- shared pool. The first salesperson to claim it becomes responsible.
    if tg_table_name = 'outreach_prospects' then
      return new;
    end if;

    if tg_op = 'INSERT' then
      new.assigned_to_user_id := new.owner_id;
      assignee_id := new.owner_id;
    else
      return new;
    end if;
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = assignee_id
      and wm.status = 'active'
  ) then
    raise exception 'the assigned user is not an active member of this workspace';
  end if;

  if tg_table_name = 'outreach_messages' then
    if not exists (
      select 1
      from public.outreach_prospects op
      where op.id = new.prospect_id
        and op.workspace_id = new.workspace_id
        and (
          op.assigned_to_user_id is null
          or op.assigned_to_user_id = new.sender_user_id
        )
    ) then
      raise exception 'the outreach sender is not assigned to this prospect';
    end if;

    if not exists (
      select 1
      from public.profiles p
      where p.user_id = new.sender_user_id
        and lower(p.outreach_sender_email) = lower(new.from_email)
    ) then
      raise exception 'the visible sender does not match the assigned account';
    end if;
  end if;

  return new;
end
$$;

revoke execute on function public.validate_livecoach_work_assignment()
  from public, anon, authenticated;

comment on column public.outreach_prospects.assigned_to_user_id is
  'Active salesperson responsible for the prospect. NULL means it is available in the shared team pool and can be claimed once.';
