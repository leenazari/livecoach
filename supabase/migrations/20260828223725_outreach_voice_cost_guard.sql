-- A voice note must be rejected before ElevenLabs is called when its
-- conservative estimated cost exceeds five pence. These columns retain the
-- exact estimate used for the successful generation so cost reporting does not
-- need to reconstruct historic pricing.

alter table public.outreach_messages
  add column if not exists voice_character_count integer,
  add column if not exists voice_estimated_cost_gbp numeric(8, 6);

alter table public.outreach_messages
  drop constraint if exists outreach_messages_voice_character_count_check,
  add constraint outreach_messages_voice_character_count_check
    check (
      voice_character_count is null
      or voice_character_count between 1 and 800
    ),
  drop constraint if exists outreach_messages_voice_estimated_cost_gbp_check,
  add constraint outreach_messages_voice_estimated_cost_gbp_check
    check (
      voice_estimated_cost_gbp is null
      or voice_estimated_cost_gbp between 0 and 0.05
    );

comment on column public.outreach_messages.voice_character_count is
  'Exact text characters sent to ElevenLabs for this generated audio.';
comment on column public.outreach_messages.voice_estimated_cost_gbp is
  'Conservative pre-generation ElevenLabs estimate, hard capped at GBP 0.05.';
