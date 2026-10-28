-- Workspace-scoped allowlist for confidential OAuth clients used by the
-- LiveCoach Custom GPT Action. Secrets remain in Supabase Auth and are never
-- stored in this table.

create table if not exists public.chatgpt_action_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  oauth_client_id text not null unique,
  gpt_id text not null unique check (gpt_id ~ '^g-[A-Za-z0-9_-]{3,160}$'),
  client_name text not null check (char_length(client_name) between 1 and 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chatgpt_action_clients_workspace_active_idx
  on public.chatgpt_action_clients (workspace_id, active, created_at desc);

create index if not exists chatgpt_action_clients_created_by_idx
  on public.chatgpt_action_clients (created_by);

alter table public.chatgpt_action_clients enable row level security;

revoke all on table public.chatgpt_action_clients from public, anon;
grant select, insert, update on table public.chatgpt_action_clients to authenticated;
grant select, insert, update, delete on table public.chatgpt_action_clients to service_role;

drop policy if exists "Active members read workspace GPT actions"
  on public.chatgpt_action_clients;
create policy "Active members read workspace GPT actions"
  on public.chatgpt_action_clients for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = chatgpt_action_clients.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

drop policy if exists "Workspace owner creates GPT actions"
  on public.chatgpt_action_clients;
create policy "Workspace owner creates GPT actions"
  on public.chatgpt_action_clients for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = chatgpt_action_clients.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  );

drop policy if exists "Workspace owner updates GPT actions"
  on public.chatgpt_action_clients;
create policy "Workspace owner updates GPT actions"
  on public.chatgpt_action_clients for update to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = chatgpt_action_clients.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = chatgpt_action_clients.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  );

create or replace function public.protect_chatgpt_action_client_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.oauth_client_id is distinct from old.oauth_client_id
    or new.gpt_id is distinct from old.gpt_id
    or new.client_name is distinct from old.client_name
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'GPT Action client identity cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists chatgpt_action_clients_protect_identity
  on public.chatgpt_action_clients;
create trigger chatgpt_action_clients_protect_identity
  before update on public.chatgpt_action_clients
  for each row execute function public.protect_chatgpt_action_client_identity();

revoke execute on function public.protect_chatgpt_action_client_identity()
  from public, anon, authenticated;

comment on table public.chatgpt_action_clients is
  'Workspace-scoped allowlist for owner-created ChatGPT Plus Custom GPT OAuth clients. No client secrets are stored.';
