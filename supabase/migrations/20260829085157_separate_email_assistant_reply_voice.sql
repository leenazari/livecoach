-- Email Assistant reply audio has its own salesperson-level voice. It must
-- never borrow the Brain voice or the separate Outreach campaign voice.

alter table public.salesperson_profiles
  add column if not exists email_assistant_voice_id text,
  add column if not exists email_assistant_voice_name text;

alter table public.salesperson_profiles
  drop constraint if exists salesperson_profiles_email_assistant_voice_id_check,
  add constraint salesperson_profiles_email_assistant_voice_id_check check (
    email_assistant_voice_id is null
    or length(btrim(email_assistant_voice_id)) between 8 and 120
  ),
  drop constraint if exists salesperson_profiles_email_assistant_voice_name_check,
  add constraint salesperson_profiles_email_assistant_voice_name_check check (
    email_assistant_voice_name is null
    or length(btrim(email_assistant_voice_name)) between 1 and 120
  );

comment on column public.salesperson_profiles.email_assistant_voice_id is
  'The signed-in salesperson''s own Email Assistant reply voice. It is independent from Brain and Outreach.';
comment on column public.salesperson_profiles.email_assistant_voice_name is
  'The user-facing name of the salesperson''s own Email Assistant reply voice.';

-- Audio produced before this separation used the Outreach voice resolver.
-- Preserve the approved words, but require editable drafts to generate fresh
-- audio only after their owner explicitly chooses an Email Assistant voice.
update public.email_assistant_drafts
set voice_status = case
      when nullif(btrim(coalesce(voice_script, '')), '') is null then 'none'
      else 'script_ready'
    end,
    voice_audio_path = null,
    voice_audio_mime = null,
    voice_generated_at = null,
    voice_script_hash = null,
    voice_model_id = null,
    voice_provider_voice_id = null,
    voice_provider_request_id = null,
    voice_estimated_seconds = null,
    voice_character_count = null,
    voice_estimated_cost_gbp = null,
    voice_error = null,
    updated_at = now()
where status in ('draft', 'blocked')
  and (
    voice_status in ('generating', 'ready', 'failed')
    or voice_audio_path is not null
    or voice_provider_voice_id is not null
  );
