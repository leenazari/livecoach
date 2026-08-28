-- Voice generation is a paid, deliberate action. Keep the free script review
-- separate from ElevenLabs generation and retain who approved the exact words.

alter table public.outreach_messages
  add column if not exists voice_script_approved_at timestamptz,
  add column if not exists voice_script_approved_by uuid,
  add column if not exists voice_script_approved_hash text;

alter table public.outreach_messages
  drop constraint if exists outreach_messages_voice_script_approval_check,
  add constraint outreach_messages_voice_script_approval_check check (
    (
      voice_script_approved_at is null
      and voice_script_approved_by is null
      and voice_script_approved_hash is null
    )
    or
    (
      voice_script_approved_at is not null
      and voice_script_approved_by is not null
      and length(voice_script_approved_hash) = 64
    )
  );

comment on column public.outreach_messages.voice_script_approved_at is
  'When the signed-in sender explicitly approved the exact voice script before paid generation.';
comment on column public.outreach_messages.voice_script_approved_by is
  'User who approved the exact voice script. The server enforces that this is the sender.';
comment on column public.outreach_messages.voice_script_approved_hash is
  'SHA-256 hash of the normalized script approved for paid voice generation.';
comment on column public.outreach_messages.voice_script is
  'The editable spoken pitch. It has no generation cost until explicitly approved and sent to ElevenLabs.';

-- This is a database-level backstop against two paid voice generations being
-- started concurrently by the same salesperson.
create unique index if not exists outreach_messages_one_voice_generation_per_sender_idx
  on public.outreach_messages (workspace_id, sender_user_id)
  where voice_status = 'generating';

alter table public.outreach_events
  drop constraint if exists outreach_events_kind_check;

alter table public.outreach_events
  add constraint outreach_events_kind_check check (kind in (
    'queued', 'researched', 'drafted', 'approved', 'sent', 'reply',
    'positive_reply', 'objection', 'later', 'referral', 'unsubscribe',
    'meeting_booked', 'booking_link_shared', 'crm_created',
    'learning_promoted', 'safety_override', 'handover_review', 'manual_call',
    'manual_call_interpreted', 'voice_script_approved', 'voice_generated',
    'voice_played', 'failed'
  ));
