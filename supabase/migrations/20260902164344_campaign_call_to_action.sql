-- Keep one structured campaign call to action rather than asking every model
-- invocation to infer it from free text. Existing campaigns retain the legacy
-- inference mode until a human chooses an explicit setting.

alter table public.outreach_campaigns
  add column if not exists cta_config jsonb not null
  default '{"type":"auto","label":"","url":""}'::jsonb;

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_cta_config_check;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_cta_config_check
  check (
    jsonb_typeof(cta_config) = 'object'
    and cta_config ? 'type'
    and (cta_config ->> 'type') in (
      'auto',
      'reply_demo',
      'reply_call',
      'personal_booking_link',
      'link',
      'video',
      'voice_note',
      'custom',
      'none'
    )
  );

comment on column public.outreach_campaigns.cta_config is
  'Human selected campaign CTA. Shared campaigns store the action type and shared asset only. Personal booking links are resolved from the exact sender account at draft time.';

update public.outreach_campaigns
set
  cta_config = '{"type":"reply_demo","label":"Book a 10 minute demo","url":""}'::jsonb,
  updated_at = now()
where lower(name) = 'workable'
  and coalesce(cta_config ->> 'type', 'auto') = 'auto';
