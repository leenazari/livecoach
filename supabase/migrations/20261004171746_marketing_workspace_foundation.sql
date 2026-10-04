-- Additive marketing foundation. Existing roles and private CRM policies stay intact.
alter table public.workspace_members add column if not exists department text not null default 'sales' check (department in ('sales','marketing'));
alter table public.workspace_invitations add column if not exists department text not null default 'sales' check (department in ('sales','marketing'));

create function public.inherit_invitation_department() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog as $$
declare invited_department text;
begin
  select wi.department into invited_department
  from public.workspace_invitations wi
  join public.profiles p on p.user_id = new.user_id and lower(p.email) = lower(wi.email)
  where wi.workspace_id = new.workspace_id and wi.invited_by = new.invited_by
    and wi.status = 'pending' and (wi.expires_at is null or wi.expires_at > now())
  order by wi.created_at desc limit 1;
  if invited_department is not null then new.department := invited_department; end if;
  return new;
end;
$$;
revoke all on function public.inherit_invitation_department() from public, anon, authenticated;
create trigger inherit_invitation_department before insert or update of role,status on public.workspace_members
for each row execute function public.inherit_invitation_department();

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 120),
  audience text not null default '' check (length(audience)<=1000),
  offer text not null default '' check (length(offer)<=1000),
  channel text not null default 'other' check (channel in ('linkedin','email','google','meta','organic','event','referral','other')),
  status text not null default 'draft' check (status in ('draft','active','paused','completed')),
  spend_gbp numeric(12,2) not null default 0 check (spend_gbp>=0),
  success_measure text not null default '' check (length(success_measure)<=500),
  review_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,workspace_id)
);
create index marketing_campaigns_workspace_created_idx on public.marketing_campaigns(workspace_id,created_at desc);

create table public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  campaign_id uuid not null,
  company_name text not null check (length(company_name) between 1 and 160),
  contact_name text not null default '' check (length(contact_name)<=160),
  contact_email text not null default '' check (length(contact_email)<=254),
  company_size text not null default '' check (length(company_size)<=120),
  notes text not null default '' check (length(notes)<=2000),
  assigned_to_user_id uuid,
  created_at timestamptz not null default now(),
  unique(id,workspace_id),
  foreign key(campaign_id,workspace_id) references public.marketing_campaigns(id,workspace_id),
  foreign key(workspace_id,assigned_to_user_id) references public.workspace_members(workspace_id,user_id)
);
create index marketing_leads_workspace_campaign_idx on public.marketing_leads(workspace_id,campaign_id,created_at desc);
create index marketing_leads_assigned_idx on public.marketing_leads(assigned_to_user_id,workspace_id);

-- Sales feedback is separate: assigned salespeople cannot rewrite source or ownership.
create table public.marketing_lead_feedback (
  lead_id uuid primary key,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id),
  stage text not null check(stage in ('accepted','rejected','demo','pilot','paid')),
  reason text not null default '' check(length(reason)<=1000),
  updated_at timestamptz not null default now(),
  foreign key(lead_id,workspace_id) references public.marketing_leads(id,workspace_id) on delete cascade
);
create index marketing_feedback_workspace_idx on public.marketing_lead_feedback(workspace_id);
create index marketing_feedback_user_idx on public.marketing_lead_feedback(user_id);

create table public.marketing_connections (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  provider text not null check(provider='ga4'),
  property_id text not null check(property_id ~ '^[0-9]{1,20}$'),
  snapshot jsonb,
  synced_at timestamptz,
  primary key(workspace_id,owner_id,provider)
);
create index marketing_connections_owner_idx on public.marketing_connections(owner_id);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_leads enable row level security;
alter table public.marketing_lead_feedback enable row level security;
alter table public.marketing_connections enable row level security;
revoke all on public.marketing_campaigns,public.marketing_leads,public.marketing_lead_feedback,public.marketing_connections from anon;
grant select,insert,update on public.marketing_campaigns,public.marketing_leads,public.marketing_lead_feedback,public.marketing_connections to authenticated;
grant all on public.marketing_campaigns,public.marketing_leads,public.marketing_lead_feedback,public.marketing_connections to service_role;

create policy marketing_campaigns_read on public.marketing_campaigns for select to authenticated using (
  exists(select 1 from public.workspace_members m where m.workspace_id=marketing_campaigns.workspace_id and m.user_id=(select auth.uid()) and m.status='active')
);
create policy marketing_campaigns_insert on public.marketing_campaigns for insert to authenticated with check (
  owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=marketing_campaigns.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
);
create policy marketing_campaigns_update on public.marketing_campaigns for update to authenticated using (
  exists(select 1 from public.workspace_members m where m.workspace_id=marketing_campaigns.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
) with check (
  exists(select 1 from public.workspace_members m where m.workspace_id=marketing_campaigns.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
);
create policy marketing_leads_read on public.marketing_leads for select to authenticated using (
  exists(select 1 from public.workspace_members m where m.workspace_id=marketing_leads.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing' or marketing_leads.assigned_to_user_id=m.user_id))
);
create policy marketing_leads_insert on public.marketing_leads for insert to authenticated with check (
  owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=marketing_leads.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
);
create policy marketing_leads_update on public.marketing_leads for update to authenticated using (
  exists(select 1 from public.workspace_members m where m.workspace_id=marketing_leads.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
) with check (
  exists(select 1 from public.workspace_members m where m.workspace_id=marketing_leads.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
);
create policy marketing_feedback_read on public.marketing_lead_feedback for select to authenticated using (
  exists(select 1 from public.marketing_leads l where l.id=marketing_lead_feedback.lead_id and l.workspace_id=marketing_lead_feedback.workspace_id)
);
create policy marketing_feedback_insert on public.marketing_lead_feedback for insert to authenticated with check (
  user_id=(select auth.uid()) and exists(select 1 from public.marketing_leads l where l.id=marketing_lead_feedback.lead_id and l.workspace_id=marketing_lead_feedback.workspace_id and l.assigned_to_user_id=(select auth.uid()))
);
create policy marketing_feedback_update on public.marketing_lead_feedback for update to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.marketing_leads l where l.id=marketing_lead_feedback.lead_id and l.workspace_id=marketing_lead_feedback.workspace_id and l.assigned_to_user_id=(select auth.uid()))
) with check (
  user_id=(select auth.uid()) and exists(select 1 from public.marketing_leads l where l.id=marketing_lead_feedback.lead_id and l.workspace_id=marketing_lead_feedback.workspace_id and l.assigned_to_user_id=(select auth.uid()))
);
create policy marketing_connections_read on public.marketing_connections for select to authenticated using (
  owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=marketing_connections.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
);
create policy marketing_connections_insert on public.marketing_connections for insert to authenticated with check (
  owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=marketing_connections.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
);
create policy marketing_connections_update on public.marketing_connections for update to authenticated using (
  owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=marketing_connections.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
) with check (
  owner_id=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=marketing_connections.workspace_id and m.user_id=(select auth.uid()) and m.status='active' and (m.role in ('owner','manager') or m.department='marketing'))
);
