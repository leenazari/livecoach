-- Legacy task policies allow a record owner without checking membership.
-- Require active membership as an additional condition for every operation,
-- including requests made with a JWT issued before account removal.
drop policy if exists "Active membership required for tasks" on public.tasks;
create policy "Active membership required for tasks"
  on public.tasks
  as restrictive
  for all
  to authenticated
  using (
    workspace_id in (
      select member.workspace_id
      from public.workspace_members member
      where member.user_id = (select auth.uid())
        and member.status = 'active'
    )
  )
  with check (
    workspace_id in (
      select member.workspace_id
      from public.workspace_members member
      where member.user_id = (select auth.uid())
        and member.status = 'active'
    )
  );
