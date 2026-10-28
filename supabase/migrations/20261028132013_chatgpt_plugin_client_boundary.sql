-- Keep personal ChatGPT plugins on the six-tool CRM surface even though
-- Supabase OAuth access tokens are not currently resource-bound. The consent
-- flow reads the pending authorization from auth.oauth_authorizations, then
-- records the exact dynamic client only when it requested /mcp/chatgpt.

create table if not exists public.chatgpt_plugin_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  oauth_client_id uuid not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists chatgpt_plugin_clients_workspace_active_idx
  on public.chatgpt_plugin_clients (workspace_id, active, created_at desc);

alter table public.chatgpt_plugin_clients enable row level security;

revoke all on table public.chatgpt_plugin_clients from public, anon, authenticated;
grant select on table public.chatgpt_plugin_clients to authenticated;
grant select, insert, update, delete on table public.chatgpt_plugin_clients to service_role;

drop policy if exists "Active members read workspace ChatGPT plugin clients"
  on public.chatgpt_plugin_clients;
create policy "Active members read workspace ChatGPT plugin clients"
  on public.chatgpt_plugin_clients for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = chatgpt_plugin_clients.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create or replace function public.classify_chatgpt_authorization(
  p_authorization_id text,
  p_register_plugin boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_count integer;
  v_workspace_id uuid;
  v_role text;
  v_client_id uuid;
  v_resource text;
  v_redirect_uri text;
  v_client_count integer;
  v_existing_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'A signed-in LiveCoach user is required';
  end if;

  select count(*), min(wm.workspace_id::text)::uuid, min(wm.role::text)
    into v_membership_count, v_workspace_id, v_role
  from public.workspace_members wm
  where wm.user_id = v_user_id
    and wm.status = 'active';

  if v_membership_count <> 1 or v_workspace_id is null then
    raise exception 'LiveCoach could not safely identify one active workspace';
  end if;

  select authz.client_id,
         authz.resource,
         authz.redirect_uri
    into v_client_id, v_resource, v_redirect_uri
  from auth.oauth_authorizations authz
  where authz.authorization_id = p_authorization_id
    and authz.user_id = v_user_id
    and authz.status::text = 'pending';

  if v_client_id is null then
    raise exception 'This OAuth request is missing, expired or belongs to another user';
  end if;

  if v_redirect_uri !~ '^https://([A-Za-z0-9-]+\.)*(chatgpt\.com|openai\.com)/' then
    raise exception 'LiveCoach blocked an unapproved OAuth destination';
  end if;

  select count(*)
    into v_client_count
  from auth.oauth_clients client
  where client.id = v_client_id
    and client.deleted_at is null
    and client.registration_type::text = 'dynamic'
    and client.client_type::text = 'public'
    and client.token_endpoint_auth_method = 'none'
    and client.client_name = 'ChatGPT'
    and client.redirect_uris = v_redirect_uri;

  if v_client_count <> 1 then
    raise exception 'LiveCoach could not verify the ChatGPT OAuth client';
  end if;

  if v_resource = 'https://www.livecoachcrm.com/mcp/chatgpt' then
    if p_register_plugin then
      insert into public.chatgpt_plugin_clients (
        workspace_id,
        oauth_client_id,
        created_by,
        active
      ) values (
        v_workspace_id,
        v_client_id,
        v_user_id,
        true
      )
      on conflict (oauth_client_id) do nothing;

      select client.workspace_id
        into v_existing_workspace_id
      from public.chatgpt_plugin_clients client
      where client.oauth_client_id = v_client_id
        and client.active = true;

      if v_existing_workspace_id is distinct from v_workspace_id then
        raise exception 'This ChatGPT plugin client belongs to another workspace';
      end if;
    end if;
    return 'chatgpt_plugin';
  end if;

  if v_resource = 'https://www.livecoachcrm.com/mcp' then
    if v_role <> 'owner' then
      raise exception 'The full LiveCoach Brain connector is restricted to a workspace owner';
    end if;
    return 'staff_mcp';
  end if;

  raise exception 'This OAuth request is for an unapproved LiveCoach resource';
end;
$$;

revoke execute on function public.classify_chatgpt_authorization(text, boolean)
  from public, anon;
grant execute on function public.classify_chatgpt_authorization(text, boolean)
  to authenticated;

comment on table public.chatgpt_plugin_clients is
  'Workspace-scoped registry of ChatGPT DCR clients approved only for the narrow six-tool CRM MCP endpoint.';

comment on function public.classify_chatgpt_authorization(text, boolean) is
  'Classifies the signed-in user pending ChatGPT authorization and optionally binds its DCR client to the narrow plugin endpoint.';
