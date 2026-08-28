-- Optional, user-triggered LinkedIn inbox capture. The browser connector keeps
-- the LinkedIn session on the user's machine and authenticates to LiveCoach
-- with a separate revocable secret. Only a one-way hash of that secret is
-- stored. Imported messages stay private to the account owner.

create table public.linkedin_inbox_connectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  token_hash text not null unique,
  token_last_four text not null,
  extension_origin text,
  max_conversations_per_run smallint not null default 10
    check (max_conversations_per_run between 1 and 20),
  lookback_days smallint not null default 14 check (lookback_days between 1 and 30),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  imported_message_count integer not null default 0
    check (imported_message_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id),
  unique (id, owner_id, workspace_id)
);

create index linkedin_inbox_connectors_workspace_idx
  on public.linkedin_inbox_connectors (workspace_id, owner_id);

alter table public.linkedin_inbox_connectors enable row level security;

-- Connector credentials and operational controls are never available through
-- the browser-facing Data API. Authenticated settings routes use the service
-- role only after middleware has selected the exact owner and workspace.
revoke all on public.linkedin_inbox_connectors from public, anon, authenticated;
grant select, insert, update, delete on public.linkedin_inbox_connectors to service_role;

create table public.linkedin_contact_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  sender_profile_url text not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, sender_profile_url),
  unique (owner_id, contact_id)
);

create index linkedin_contact_links_workspace_idx
  on public.linkedin_contact_links (workspace_id, owner_id);

alter table public.linkedin_contact_links enable row level security;
revoke all on public.linkedin_contact_links from public, anon, authenticated;
grant select, insert, update, delete on public.linkedin_contact_links to service_role;

create table public.linkedin_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  connector_id uuid,
  provider_conversation_id text not null,
  provider_message_id text not null,
  sender_name text not null,
  sender_profile_url text not null,
  body text not null,
  received_at timestamptz not null,
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  context_id uuid references public.client_context(id) on delete set null,
  status text not null default 'review'
    check (status in ('linked', 'review', 'reviewed')),
  review_reason text,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint linkedin_inbox_messages_connector_scope_fkey
    foreign key (connector_id, owner_id, workspace_id)
    references public.linkedin_inbox_connectors(id, owner_id, workspace_id)
    on delete set null (connector_id),
  unique (owner_id, provider_message_id)
);

create index linkedin_inbox_messages_owner_received_idx
  on public.linkedin_inbox_messages (owner_id, received_at desc);
create index linkedin_inbox_messages_owner_review_idx
  on public.linkedin_inbox_messages (owner_id, status, received_at desc)
  where status = 'review';
create index linkedin_inbox_messages_company_idx
  on public.linkedin_inbox_messages (company_id, received_at desc)
  where company_id is not null;

alter table public.linkedin_inbox_messages enable row level security;
revoke all on public.linkedin_inbox_messages from public, anon, authenticated;
grant select on public.linkedin_inbox_messages to authenticated;
grant select, insert, update, delete on public.linkedin_inbox_messages to service_role;

create policy "Owners read their LinkedIn inbox messages"
  on public.linkedin_inbox_messages
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = linkedin_inbox_messages.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

comment on table public.linkedin_inbox_connectors is
  'Hashed, revocable credentials and hard limits for the local LinkedIn inbox connector.';
comment on table public.linkedin_contact_links is
  'Exact owner-scoped LinkedIn profile to CRM contact identity links.';
comment on table public.linkedin_inbox_messages is
  'Inbound LinkedIn messages captured by a user-triggered local browser connector.';
