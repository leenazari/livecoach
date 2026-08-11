-- Queue only newly-arrived, compact commercial evidence for one evidence-led
-- outlook pass. The underlying call, email, activity and outreach records stay
-- authoritative; this table is an idempotency receipt and processing queue,
-- not a second CRM or transcript store.

create table if not exists public.opportunity_signal_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  workstream_id uuid,
  opportunity_id uuid,
  source_record_type text not null
    check (source_record_type in ('call_summary','important_email','manual_activity','outreach_reply')),
  source_record_id text not null,
  source_channel text not null
    check (source_channel in ('automated_email','personal_email','phone','video_call','linkedin','event','in_person','other')),
  occurred_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'queued'
    check (status in ('queued','processing','complete','ignored','protected','failed')),
  result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result) = 'object'),
  attempts smallint not null default 0
    check (attempts between 0 and 3),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_record_type, source_record_id)
);

create index if not exists opportunity_signal_receipts_queue_idx
  on public.opportunity_signal_receipts (status, updated_at, created_at)
  where status in ('queued','failed');

create index if not exists opportunity_signal_receipts_opportunity_idx
  on public.opportunity_signal_receipts (opportunity_id, created_at desc)
  where opportunity_id is not null;

alter table public.opportunity_signal_receipts enable row level security;
revoke all on table public.opportunity_signal_receipts from anon, authenticated;
revoke all on table public.opportunity_signal_receipts from service_role;
grant select, insert, update on table public.opportunity_signal_receipts to service_role;

comment on table public.opportunity_signal_receipts is
  'Service-only idempotency receipts for one compact outlook assessment when new material CRM evidence arrives.';
