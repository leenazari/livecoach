-- Owner-scoped SendPilot credentials and webhook receipts. Credentials are
-- encrypted by the application with a deployment secret before they reach the
-- database. Neither table is available through the browser-facing Data API.

create table public.sendpilot_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  status text not null default 'active' check (status in ('active', 'disconnected')),
  api_key_ciphertext text,
  api_key_last_four text,
  sendpilot_workspace_id text,
  sender_id text not null,
  sender_name text not null,
  sender_linkedin_url text not null,
  sender_status text not null default 'active',
  webhook_path_token text not null unique,
  webhook_secret_ciphertext text,
  last_backfill_started_at timestamptz,
  last_backfill_at timestamptz,
  last_webhook_at timestamptz,
  last_error text,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id),
  unique (id, owner_id, workspace_id)
);

create index sendpilot_integrations_workspace_owner_idx
  on public.sendpilot_integrations (workspace_id, owner_id);

alter table public.sendpilot_integrations enable row level security;
revoke all on public.sendpilot_integrations from public, anon, authenticated;
grant select, insert, update, delete on public.sendpilot_integrations to service_role;

create table public.sendpilot_webhook_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  provider_event_id text not null,
  event_type text not null,
  provider_timestamp timestamptz not null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  payload_digest text not null,
  linked_inbox_message_id uuid references public.linkedin_inbox_messages(id) on delete set null,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sendpilot_webhook_events_integration_scope_fkey
    foreign key (integration_id, owner_id, workspace_id)
    references public.sendpilot_integrations(id, owner_id, workspace_id)
    on delete cascade,
  unique (integration_id, provider_event_id)
);

create index sendpilot_webhook_events_workspace_owner_received_idx
  on public.sendpilot_webhook_events (workspace_id, owner_id, received_at desc);
create index sendpilot_webhook_events_integration_scope_idx
  on public.sendpilot_webhook_events (integration_id, owner_id, workspace_id);
create index sendpilot_webhook_events_linked_message_idx
  on public.sendpilot_webhook_events (linked_inbox_message_id)
  where linked_inbox_message_id is not null;

alter table public.sendpilot_webhook_events enable row level security;
revoke all on public.sendpilot_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on public.sendpilot_webhook_events to service_role;

comment on table public.sendpilot_integrations is
  'Encrypted owner-scoped SendPilot API access and inbound webhook configuration.';
comment on table public.sendpilot_webhook_events is
  'Service-only SendPilot webhook idempotency receipts without duplicate message bodies.';
