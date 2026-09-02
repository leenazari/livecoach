-- A prospect can deliberately override the campaign CTA for this exact
-- campaign enrolment. Null means inherit the current campaign default. Shared
-- records never store a salesperson's private booking URL. That URL is
-- resolved from the authenticated sender only when a draft is generated.

alter table public.outreach_enrolments
  add column if not exists cta_config jsonb;

alter table public.outreach_enrolments
  drop constraint if exists outreach_enrolments_cta_config_check;

alter table public.outreach_enrolments
  add constraint outreach_enrolments_cta_config_check
  check (
    cta_config is null
    or (
      jsonb_typeof(cta_config) = 'object'
      and cta_config ? 'type'
      and (cta_config ->> 'type') in (
        'reply_demo',
        'reply_call',
        'personal_booking_link',
        'link',
        'video',
        'voice_note',
        'custom',
        'none'
      )
    )
  );

comment on column public.outreach_enrolments.cta_config is
  'Optional human selected CTA for this prospect and campaign. Null inherits the campaign default. Personal booking links are resolved from the exact sender account and are never stored here.';
