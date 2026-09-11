alter table public.workspaces add column if not exists team_lead_cover_enabled boolean not null default false;
comment on column public.workspaces.team_lead_cover_enabled is 'Owner-enabled access for active members to collaborate on ordinary sales leads through guarded CRM routes. Does not transfer ownership or grant access to confidential or non-sales sources.';
