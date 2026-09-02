-- Important personal-email alerts reuse the existing private notification
-- feed. The email and its canonical follow-up task remain the source of truth.
-- This migration only extends the delivery receipt type and never replays old
-- messages or creates historical notifications.
alter table public.crm_notifications
  drop constraint if exists crm_notifications_kind_check,
  add constraint crm_notifications_kind_check check (
    kind in (
      'outreach_reply',
      'important_email',
      'lead_assigned',
      'chat_message'
    )
  );

comment on column public.crm_notifications.kind is
  'Delivery category for replies, important emails, assignments and team chat. Canonical source records remain authoritative.';
