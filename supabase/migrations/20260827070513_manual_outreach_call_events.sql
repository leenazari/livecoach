-- Manual sales calls are evidence in the existing outreach history. The raw
-- call and its later compact interpretation are separate append-only rows, so
-- the original note is never overwritten by AI.

alter table public.outreach_events
  drop constraint if exists outreach_events_kind_check;

alter table public.outreach_events
  add constraint outreach_events_kind_check check (kind in (
    'queued', 'researched', 'drafted', 'approved', 'sent', 'reply',
    'positive_reply', 'objection', 'later', 'referral', 'unsubscribe',
    'meeting_booked', 'booking_link_shared', 'crm_created',
    'learning_promoted', 'safety_override', 'handover_review', 'manual_call',
    'manual_call_interpreted', 'failed'
  ));

create unique index if not exists outreach_manual_call_request_once_idx
  on public.outreach_events (
    workspace_id,
    owner_id,
    (metadata ->> 'requestId')
  )
  where kind = 'manual_call'
    and metadata ? 'requestId';

create unique index if not exists outreach_manual_call_interpretation_once_idx
  on public.outreach_events (
    workspace_id,
    owner_id,
    (metadata ->> 'requestId')
  )
  where kind = 'manual_call_interpreted'
    and metadata ? 'requestId';

create index if not exists outreach_manual_calls_owner_created_idx
  on public.outreach_events (workspace_id, owner_id, created_at desc)
  where kind = 'manual_call';

comment on index public.outreach_manual_call_request_once_idx is
  'Makes one salesperson call log idempotent without mutating its original evidence.';
