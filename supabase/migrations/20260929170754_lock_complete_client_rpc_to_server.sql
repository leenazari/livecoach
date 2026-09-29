-- The atomic writer needs elevated visibility to detect workspace-wide email
-- duplicates and to reuse an explicitly assigned private client. Keep that
-- power behind the verified Next.js route instead of exposing the definer
-- function through the authenticated Data API.

revoke all on function public.create_complete_crm_client(
  uuid, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.create_complete_crm_client_server(
  p_actor_id uuid,
  p_workspace_id uuid,
  p_company_name text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_job_title text,
  p_record_type text,
  p_relationship_stage text,
  p_existing_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_actor_id is null or not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_actor_id
      and wm.status = 'active'
  ) then
    raise exception 'complete_client_membership_required';
  end if;

  -- Recreate the already verified browser identity inside this single server
  -- transaction. The inner writer and every existing safety trigger continue
  -- to enforce the same auth.uid() account boundary.
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_actor_id, 'role', 'authenticated')::text,
    true
  );

  return public.create_complete_crm_client(
    p_workspace_id,
    p_company_name,
    p_first_name,
    p_last_name,
    p_email,
    p_job_title,
    p_record_type,
    p_relationship_stage,
    p_existing_company_id
  );
end;
$$;

comment on function public.create_complete_crm_client_server(
  uuid, uuid, text, text, text, text, text, text, text, uuid
) is 'Service-only wrapper for the verified CRM complete-client route. It binds one active workspace member before running the atomic writer.';

revoke all on function public.create_complete_crm_client_server(
  uuid, uuid, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.create_complete_crm_client_server(
  uuid, uuid, text, text, text, text, text, text, text, uuid
) to service_role;
