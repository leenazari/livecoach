-- Keep inbound client email as one immutable, reusable CRM activity. The
-- provider message id makes the hourly delta monitor and daily safety sweep
-- idempotent without copying whole email threads into another store.
alter table public.client_context
  add column if not exists source_ref text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists client_context_owner_source_ref_unique
  on public.client_context (owner_id, source_ref);

comment on column public.client_context.source_ref is
  'Stable provider and message identifier used to prevent duplicate activity ingestion.';

comment on column public.client_context.metadata is
  'Structured activity facts such as sender, received time, reply type and explicit return date.';
