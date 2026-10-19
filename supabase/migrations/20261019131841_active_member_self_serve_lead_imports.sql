-- Importing your own leads is a standard active-member capability. Retain the
-- legacy grant rows for audit history, but do not require per-person grants.
-- Apply/undo still enforce uploader ownership, workspace, self-assignment,
-- duplicate checks and the existing owner-only assignment exception.
create or replace function public.can_stage_outreach_import_service(
  p_workspace_id uuid, p_actor_user_id uuid
)
returns boolean language sql stable security invoker set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_user_id
      and wm.status = 'active'
  );
$$;

revoke all on function public.can_stage_outreach_import_service(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_stage_outreach_import_service(uuid, uuid)
  to service_role;

alter policy "Importers read their own private batches"
  on public.crm_import_batches
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = crm_import_batches.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

comment on table public.crm_import_batches is
  'Uploader-private staged Outreach imports. Active members import for themselves; only owners may choose another assignee.';
