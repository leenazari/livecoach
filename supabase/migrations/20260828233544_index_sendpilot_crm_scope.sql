-- Cover every foreign-key lookup on the private SendPilot campaign and lead
-- links. These tables are service-only, but deletes and ownership changes must
-- remain predictable as each salesperson's tracked lead volume grows.

create index sendpilot_campaign_links_integration_scope_idx
  on public.sendpilot_campaign_links (integration_id, owner_id, workspace_id);
create index sendpilot_campaign_links_owner_fk_idx
  on public.sendpilot_campaign_links (owner_id);
create index sendpilot_campaign_links_livecoach_campaign_idx
  on public.sendpilot_campaign_links (livecoach_campaign_id);

create index sendpilot_lead_links_campaign_link_idx
  on public.sendpilot_lead_links (campaign_link_id)
  where campaign_link_id is not null;
create index sendpilot_lead_links_integration_scope_idx
  on public.sendpilot_lead_links (integration_id, owner_id, workspace_id);
create index sendpilot_lead_links_livecoach_campaign_idx
  on public.sendpilot_lead_links (livecoach_campaign_id)
  where livecoach_campaign_id is not null;
create index sendpilot_lead_links_enrolment_fk_idx
  on public.sendpilot_lead_links (outreach_enrolment_id)
  where outreach_enrolment_id is not null;
create index sendpilot_lead_links_owner_fk_idx
  on public.sendpilot_lead_links (owner_id);
