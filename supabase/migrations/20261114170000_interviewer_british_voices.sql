-- Not applied. Widens the voice check so the owner can save the Aura-1
-- British voices as well as the two Aura-2 British voices.
-- Apply this on a branch before choosing Helios or Athena. Draco and Pandora
-- already satisfy the previous check.

alter table public.interviewer_campaigns
  drop constraint if exists interviewer_campaigns_voice_id_check;

alter table public.interviewer_campaigns
  add constraint interviewer_campaigns_voice_id_check
  check (voice_id in (
    'aura-2-draco-en',
    'aura-2-pandora-en',
    'aura-helios-en',
    'aura-athena-en'
  ));
