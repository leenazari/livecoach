alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_daily_limit_check;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_daily_limit_check
  check (daily_limit between 1 and 50);

alter table public.outreach_campaigns
  alter column daily_limit set default 50;
