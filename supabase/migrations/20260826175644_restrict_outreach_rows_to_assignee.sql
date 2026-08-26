-- The application already scopes each sales screen to the signed in user's
-- assignments. Enforce the same boundary in Postgres so a salesperson cannot
-- bypass the API and read or edit another salesperson's outreach work through
-- the Data API. Workspace owners and managers retain the full operational view.

drop policy if exists "Members read permitted records"
  on public.outreach_prospects;
create policy "Members read assigned or available outreach prospects"
  on public.outreach_prospects for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_prospects.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_prospects.owner_id = (select auth.uid())
          or (
            outreach_prospects.visibility = 'team'
            and (
              outreach_prospects.assigned_to_user_id = (select auth.uid())
              or outreach_prospects.assigned_to_user_id is null
            )
          )
        )
    )
  );

drop policy if exists "Members update permitted records"
  on public.outreach_prospects;
create policy "Members update assigned or available outreach prospects"
  on public.outreach_prospects for update to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_prospects.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_prospects.owner_id = (select auth.uid())
          or (
            outreach_prospects.visibility = 'team'
            and (
              outreach_prospects.assigned_to_user_id = (select auth.uid())
              or outreach_prospects.assigned_to_user_id is null
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_prospects.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_prospects.owner_id = (select auth.uid())
          or (
            outreach_prospects.visibility = 'team'
            and (
              outreach_prospects.assigned_to_user_id = (select auth.uid())
              or outreach_prospects.assigned_to_user_id is null
            )
          )
        )
    )
  );

create or replace function public.protect_unassigned_outreach_prospect_work()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
begin
  if actor_id is null then
    return new;
  end if;

  select wm.role into actor_role
  from public.workspace_members wm
  where wm.workspace_id = old.workspace_id
    and wm.user_id = actor_id
    and wm.status = 'active';

  if actor_role in ('owner', 'manager')
    or old.owner_id = actor_id then
    return new;
  end if;

  if actor_role <> 'sales' then
    raise exception 'an active sales membership is required';
  end if;

  if old.assigned_to_user_id is null then
    if new.assigned_to_user_id is distinct from actor_id then
      raise exception 'claim this prospect before changing it';
    end if;

    if (to_jsonb(new) - array['assigned_to_user_id', 'updated_at'])
      is distinct from
      (to_jsonb(old) - array['assigned_to_user_id', 'updated_at']) then
      raise exception 'claim the prospect before editing its sales data';
    end if;

    return new;
  end if;

  if old.assigned_to_user_id = actor_id
    and (
      new.assigned_to_user_id = actor_id
      or new.assigned_to_user_id is null
    ) then
    return new;
  end if;

  raise exception 'this prospect belongs to another salesperson';
end;
$$;

drop trigger if exists outreach_prospects_protect_unassigned_work
  on public.outreach_prospects;
create trigger outreach_prospects_protect_unassigned_work
  before update on public.outreach_prospects
  for each row execute function public.protect_unassigned_outreach_prospect_work();

revoke execute on function public.protect_unassigned_outreach_prospect_work()
  from public, anon, authenticated;

drop policy if exists "Members read permitted records"
  on public.outreach_messages;
create policy "Members read their outreach messages"
  on public.outreach_messages for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_messages.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_messages.sender_user_id = (select auth.uid())
        )
    )
  );

drop policy if exists "Members update permitted records"
  on public.outreach_messages;
create policy "Members update their outreach messages"
  on public.outreach_messages for update to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_messages.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_messages.sender_user_id = (select auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_messages.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_messages.sender_user_id = (select auth.uid())
        )
    )
  );

drop policy if exists "Members read permitted records"
  on public.outreach_enrolments;
create policy "Members read relevant outreach enrolments"
  on public.outreach_enrolments for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_enrolments.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_enrolments.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.outreach_prospects prospect
            where prospect.id = outreach_enrolments.prospect_id
              and prospect.workspace_id = outreach_enrolments.workspace_id
              and prospect.assigned_to_user_id = (select auth.uid())
          )
          or (
            outreach_enrolments.status = 'paused'
            and coalesce(outreach_enrolments.current_step, 1) <= 1
            and outreach_enrolments.queued_for is null
            and outreach_enrolments.next_action_at is null
            and outreach_enrolments.researched_at is null
            and outreach_enrolments.last_sent_at is null
            and outreach_enrolments.replied_at is null
            and outreach_enrolments.booked_at is null
            and (
              outreach_enrolments.research is null
              or outreach_enrolments.research in ('{}'::jsonb, '[]'::jsonb, '""'::jsonb)
            )
            and (
              outreach_enrolments.research_sources is null
              or outreach_enrolments.research_sources in (
                '{}'::jsonb,
                '[]'::jsonb,
                '""'::jsonb
              )
            )
            and exists (
              select 1
              from public.outreach_prospects prospect
              where prospect.id = outreach_enrolments.prospect_id
                and prospect.workspace_id = outreach_enrolments.workspace_id
                and prospect.visibility = 'team'
                and prospect.assigned_to_user_id is null
            )
          )
        )
    )
  );

drop policy if exists "Members update permitted records"
  on public.outreach_enrolments;
create policy "Members update their outreach enrolments"
  on public.outreach_enrolments for update to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_enrolments.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_enrolments.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.outreach_prospects prospect
            where prospect.id = outreach_enrolments.prospect_id
              and prospect.workspace_id = outreach_enrolments.workspace_id
              and prospect.assigned_to_user_id = (select auth.uid())
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_enrolments.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_enrolments.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.outreach_prospects prospect
            where prospect.id = outreach_enrolments.prospect_id
              and prospect.workspace_id = outreach_enrolments.workspace_id
              and prospect.assigned_to_user_id = (select auth.uid())
          )
        )
    )
  );

drop policy if exists "Members read permitted records"
  on public.outreach_events;
create policy "Members read relevant outreach events"
  on public.outreach_events for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_events.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_events.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.outreach_messages message
            where message.id = outreach_events.message_id
              and message.workspace_id = outreach_events.workspace_id
              and message.sender_user_id = (select auth.uid())
          )
          or exists (
            select 1
            from public.outreach_prospects prospect
            where prospect.id = outreach_events.prospect_id
              and prospect.workspace_id = outreach_events.workspace_id
              and prospect.assigned_to_user_id = (select auth.uid())
          )
        )
    )
  );

drop policy if exists "Members update permitted records"
  on public.outreach_events;
create policy "Members update relevant outreach events"
  on public.outreach_events for update to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_events.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_events.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.outreach_prospects prospect
            where prospect.id = outreach_events.prospect_id
              and prospect.workspace_id = outreach_events.workspace_id
              and prospect.assigned_to_user_id = (select auth.uid())
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = outreach_events.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          wm.role in ('owner', 'manager')
          or outreach_events.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.outreach_prospects prospect
            where prospect.id = outreach_events.prospect_id
              and prospect.workspace_id = outreach_events.workspace_id
              and prospect.assigned_to_user_id = (select auth.uid())
          )
        )
    )
  );

comment on function public.protect_unassigned_outreach_prospect_work() is
  'Prevents a salesperson editing a shared prospect until they atomically claim it. Owners and managers retain full workspace control.';
