-- Personal outreach voice notes reuse the approved message record as their
-- canonical source. Audio is private in Storage and exposed to a recipient
-- only through one unguessable message token handled by the server.

alter table public.salesperson_profiles
  add column if not exists outreach_voice_id text,
  add column if not exists outreach_voice_name text;

alter table public.salesperson_profiles
  drop constraint if exists salesperson_profiles_outreach_voice_id_check,
  add constraint salesperson_profiles_outreach_voice_id_check
    check (
      outreach_voice_id is null
      or length(trim(outreach_voice_id)) between 8 and 120
    ),
  drop constraint if exists salesperson_profiles_outreach_voice_name_check,
  add constraint salesperson_profiles_outreach_voice_name_check
    check (
      outreach_voice_name is null
      or length(trim(outreach_voice_name)) between 1 and 120
    );

comment on column public.salesperson_profiles.outreach_voice_id is
  'The signed-in salesperson own ElevenLabs voice id. This is never shared across users.';
comment on column public.salesperson_profiles.outreach_voice_name is
  'A user-facing label for the salesperson own outreach voice.';

alter table public.outreach_messages
  add column if not exists voice_script text,
  add column if not exists voice_status text not null default 'none',
  add column if not exists voice_audio_path text,
  add column if not exists voice_audio_mime text,
  add column if not exists voice_generated_at timestamptz,
  add column if not exists voice_script_hash text,
  add column if not exists voice_public_token uuid not null default gen_random_uuid(),
  add column if not exists voice_model_id text,
  add column if not exists voice_provider_voice_id text,
  add column if not exists voice_provider_request_id text,
  add column if not exists voice_estimated_seconds integer,
  add column if not exists voice_error text;

alter table public.outreach_messages
  drop constraint if exists outreach_messages_voice_status_check,
  add constraint outreach_messages_voice_status_check
    check (voice_status in ('none', 'script_ready', 'generating', 'ready', 'failed')),
  drop constraint if exists outreach_messages_voice_script_check,
  add constraint outreach_messages_voice_script_check
    check (voice_script is null or length(trim(voice_script)) between 1 and 1800),
  drop constraint if exists outreach_messages_voice_estimated_seconds_check,
  add constraint outreach_messages_voice_estimated_seconds_check
    check (
      voice_estimated_seconds is null
      or voice_estimated_seconds between 20 and 90
    );

create unique index if not exists outreach_messages_voice_public_token_unique
  on public.outreach_messages (voice_public_token);

create index if not exists outreach_messages_sender_voice_ready_idx
  on public.outreach_messages (workspace_id, sender_user_id, updated_at desc)
  where voice_status = 'ready';

comment on column public.outreach_messages.voice_script is
  'The one approved spoken pitch associated with this exact outreach draft.';
comment on column public.outreach_messages.voice_audio_path is
  'Private Storage path. Never send this raw path to a recipient.';
comment on column public.outreach_messages.voice_public_token is
  'Random bearer token used only by the public server-rendered listening page.';
comment on column public.outreach_messages.voice_script_hash is
  'Idempotency hash over script, sender voice and model. Unchanged audio is reused.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'outreach-voice-notes',
  'outreach-voice-notes',
  false,
  5242880,
  array['audio/mpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No anon or authenticated Storage policy is added. Upload, signing and
-- deletion happen only in server routes after exact workspace and sender
-- checks. The service role bypasses Storage RLS for those trusted operations.

alter table public.outreach_events
  drop constraint if exists outreach_events_kind_check;

alter table public.outreach_events
  add constraint outreach_events_kind_check check (kind in (
    'queued', 'researched', 'drafted', 'approved', 'sent', 'reply',
    'positive_reply', 'objection', 'later', 'referral', 'unsubscribe',
    'meeting_booked', 'booking_link_shared', 'crm_created',
    'learning_promoted', 'safety_override', 'handover_review', 'manual_call',
    'manual_call_interpreted', 'voice_generated', 'voice_played', 'failed'
  ));

create unique index if not exists outreach_voice_first_play_once_idx
  on public.outreach_events (message_id)
  where kind = 'voice_played';
