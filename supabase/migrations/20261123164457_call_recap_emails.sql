-- Migration version matches the verified production migration receipt.
-- A private, durable receipt per account and canonical call. No raw transcript
-- is copied here. A claimed send is never automatically attempted a second time.
create table public.call_recap_emails (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  owner_id uuid not null references auth.users(id),
  call_id uuid not null references public.interview_summaries(id) on delete cascade,
  session_id text not null,
  status text not null default 'queued' check (status in ('queued','preparing','ready','sending','sent','needs_review','uncertain','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  recap jsonb,
  source_hash text,
  meeting_at timestamptz,
  recipient text,
  provider_message_id text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, session_id)
);
create index call_recap_emails_pending on public.call_recap_emails(workspace_id,owner_id,created_at)
  where status in ('queued','preparing','ready','sending');
alter table public.call_recap_emails enable row level security;
revoke all on public.call_recap_emails from public, anon, authenticated;
grant select on public.call_recap_emails to authenticated;
grant all on public.call_recap_emails to service_role;
create policy call_recap_email_owner_read on public.call_recap_emails for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.workspace_members m
  where m.workspace_id = call_recap_emails.workspace_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
));
