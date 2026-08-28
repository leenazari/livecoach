-- Five pence is the normal outreach voice target. Allow a small explicit
-- overage so a useful personalised sentence is never cut off. The application
-- still rejects anything above the emergency ceiling before ElevenLabs runs.

alter table public.outreach_messages
  drop constraint if exists outreach_messages_voice_character_count_check,
  add constraint outreach_messages_voice_character_count_check
    check (
      voice_character_count is null
      or voice_character_count between 1 and 1200
    ),
  drop constraint if exists outreach_messages_voice_estimated_cost_gbp_check,
  add constraint outreach_messages_voice_estimated_cost_gbp_check
    check (
      voice_estimated_cost_gbp is null
      or voice_estimated_cost_gbp between 0 and 0.075
    );

comment on column public.outreach_messages.voice_character_count is
  'Exact approved script character count used for the voice estimate and generation.';
comment on column public.outreach_messages.voice_estimated_cost_gbp is
  'Conservative estimate shown before generation. GBP 0.05 is the target and GBP 0.075 is the emergency ceiling.';
