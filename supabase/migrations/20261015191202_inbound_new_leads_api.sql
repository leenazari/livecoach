-- Dedicated inbound queue. No configuration, reviewer, credentials or traffic is enabled by this migration.
create table public.inbound_lead_settings (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 enabled boolean not null default false,
 reviewer_user_id uuid references auth.users(id),
 sales_user_ids uuid[] not null default '{}',
 handoff_campaign_id uuid,
 updated_at timestamptz not null default now(),
 check (not enabled or reviewer_user_id is not null),
 foreign key (handoff_campaign_id,workspace_id) references public.marketing_campaigns(id,workspace_id)
);
create table public.inbound_lead_keys (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.inbound_lead_settings(workspace_id) on delete cascade,
 created_by uuid not null references auth.users(id), label text not null check(length(label) between 1 and 120),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'), token_prefix text not null check(length(token_prefix)<=16),
 scopes text[] not null check(cardinality(scopes)>0 and scopes <@ array['leads:create','leads:read','leads:update','events:write']::text[]),
 sources text[] not null check(cardinality(sources)>0 and sources <@ array['facebook','google']::text[]),
 event_types text[] not null default '{}', enabled boolean not null default true,
 expires_at timestamptz not null, created_at timestamptz not null default now(),
 window_started_at timestamptz not null default now(), window_requests integer not null default 0,
 unique(id,workspace_id)
);
create index inbound_keys_workspace_idx on public.inbound_lead_keys(workspace_id);
create table public.inbound_leads (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.inbound_lead_settings(workspace_id),
 source text not null check(source in ('facebook','google')), source_lead_id text not null check(length(source_lead_id) between 1 and 200),
 company_name text not null check(length(company_name) between 1 and 160), contact_name text not null check(length(contact_name) between 1 and 160),
 contact_email text not null check(length(contact_email)<=254), contact_phone text not null check(contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
 business_type text not null default '' check(length(business_type)<=160), company_size text not null default '' check(length(company_size)<=120),
 need text not null default '' check(length(need)<=2000), source_details jsonb not null default '{}', consent jsonb not null default '{}',
 qualification jsonb not null default '{}', initial_payload jsonb not null,
 status text not null default 'new' check(status in ('new','in_review','ready','rejected','assigned')),
 version integer not null default 1, review_note text not null default '' check(length(review_note)<=1600),
 duplicate_of uuid references public.inbound_leads(id), human_takeover boolean not null default false, contact_stopped boolean not null default false, journey_completed boolean not null default false,
 assigned_to_user_id uuid, marketing_lead_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,workspace_id), unique(workspace_id,source,source_lead_id),
 foreign key(workspace_id,assigned_to_user_id) references public.workspace_members(workspace_id,user_id),
 foreign key(marketing_lead_id,workspace_id) references public.marketing_leads(id,workspace_id),
 check((status='assigned') = (assigned_to_user_id is not null and marketing_lead_id is not null))
);
create index inbound_leads_queue_idx on public.inbound_leads(workspace_id,status,created_at desc,id);
create index inbound_leads_email_idx on public.inbound_leads(workspace_id,contact_email);
create index inbound_leads_phone_idx on public.inbound_leads(workspace_id,contact_phone);
create index inbound_leads_duplicate_idx on public.inbound_leads(duplicate_of);
create index inbound_leads_assignee_idx on public.inbound_leads(workspace_id,assigned_to_user_id);
create index inbound_leads_marketing_idx on public.inbound_leads(marketing_lead_id,workspace_id);
create index inbound_settings_reviewer_idx on public.inbound_lead_settings(reviewer_user_id);
create index inbound_settings_campaign_idx on public.inbound_lead_settings(handoff_campaign_id,workspace_id);
create index inbound_keys_creator_idx on public.inbound_lead_keys(created_by);
create table public.inbound_lead_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, lead_id uuid not null,
 key_id uuid, actor_id uuid references auth.users(id), event_type text not null,
 occurred_at timestamptz not null, details jsonb not null default '{}', received_at timestamptz not null default now(),
 foreign key(lead_id,workspace_id) references public.inbound_leads(id,workspace_id) on delete cascade,
 foreign key(key_id,workspace_id) references public.inbound_lead_keys(id,workspace_id)
);
create index inbound_events_lead_idx on public.inbound_lead_events(workspace_id,lead_id,occurred_at desc);
create index inbound_events_key_idx on public.inbound_lead_events(key_id,workspace_id);
create index inbound_events_actor_idx on public.inbound_lead_events(actor_id);
create table public.inbound_lead_receipts (
 workspace_id uuid not null references public.inbound_lead_settings(workspace_id), request_key text not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(workspace_id,request_key)
);

alter table public.inbound_lead_settings enable row level security;
alter table public.inbound_lead_keys enable row level security;
alter table public.inbound_leads enable row level security;
alter table public.inbound_lead_events enable row level security;
alter table public.inbound_lead_receipts enable row level security;
revoke all on public.inbound_lead_settings,public.inbound_lead_keys,public.inbound_leads,public.inbound_lead_events,public.inbound_lead_receipts from public,anon,authenticated;
grant select on public.inbound_lead_settings,public.inbound_leads,public.inbound_lead_events to authenticated;
grant all on public.inbound_lead_settings,public.inbound_lead_keys,public.inbound_leads,public.inbound_lead_events,public.inbound_lead_receipts to service_role;
create policy inbound_settings_read on public.inbound_lead_settings for select to authenticated using (
 exists(select 1 from public.workspace_members m where m.workspace_id=inbound_lead_settings.workspace_id and m.user_id=(select auth.uid()) and m.status='active'
 and (m.role='owner' or (inbound_lead_settings.enabled and m.user_id=inbound_lead_settings.reviewer_user_id)))
);
create function public.inbound_can_review(p_workspace_id uuid) returns boolean language sql stable security invoker set search_path=public,pg_catalog as $$
 select exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.status='active'
 and (m.role='owner' or exists(select 1 from public.inbound_lead_settings s where s.workspace_id=p_workspace_id and s.enabled and s.reviewer_user_id=m.user_id)))
$$;
revoke all on function public.inbound_can_review(uuid) from public,anon;
grant execute on function public.inbound_can_review(uuid) to authenticated,service_role;
create policy inbound_leads_read on public.inbound_leads for select to authenticated using(public.inbound_can_review(workspace_id));
create policy inbound_events_read on public.inbound_lead_events for select to authenticated using(public.inbound_can_review(workspace_id));

-- Only a deliberate handover creates an ordinary sales-visible marketing record.
alter table public.marketing_leads add column contact_phone text not null default '';
alter table public.marketing_leads add column source_inbound_lead_id uuid references public.inbound_leads(id);
alter table public.marketing_leads add column inbound_context jsonb not null default '{}';
create unique index marketing_leads_inbound_unique on public.marketing_leads(source_inbound_lead_id) where source_inbound_lead_id is not null;
create policy inbound_handoff_insert_guard on public.marketing_leads as restrictive for insert to authenticated with check(source_inbound_lead_id is null);
create policy inbound_handoff_update_guard on public.marketing_leads as restrictive for update to authenticated using(source_inbound_lead_id is null or public.inbound_can_review(workspace_id)) with check(source_inbound_lead_id is null or public.inbound_can_review(workspace_id));

-- Server-only operations use the existing service client, with explicit workspace and current membership checks.
-- SECURITY INVOKER + service_role-only EXECUTE avoids a publicly callable definer function.
create function public.inbound_admin_command(p_workspace_id uuid,p_actor_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare s public.inbound_lead_settings; k public.inbound_lead_keys; v uuid; ids uuid[];
begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id and role='owner' and status='active') then raise exception 'inbound_forbidden'; end if;
 if p_action='configure' then
  v:=nullif(p_payload->>'reviewerId','')::uuid;
  if v is not null and not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=v and status='active' and department='marketing') then raise exception 'inbound_invalid_reviewer'; end if;
  select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_payload->'salesIds');
  if exists(select 1 from unnest(ids) x where not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=x and m.status='active' and m.department='sales' and m.role='sales')) then raise exception 'inbound_invalid_sales'; end if;
  insert into public.inbound_lead_settings(workspace_id,enabled,reviewer_user_id,sales_user_ids) values(p_workspace_id,(p_payload->>'enabled')::boolean,v,ids)
  on conflict(workspace_id) do update set enabled=excluded.enabled,reviewer_user_id=excluded.reviewer_user_id,sales_user_ids=excluded.sales_user_ids,updated_at=now() returning * into s;
  return jsonb_build_object('enabled',s.enabled);
 end if;
 if p_action='revoke_key' then
  update public.inbound_lead_keys set enabled=false where workspace_id=p_workspace_id and id=(p_payload->>'keyId')::uuid returning * into k;
  if not found then raise exception 'inbound_not_found'; end if;
  return jsonb_build_object('revoked',true);
 end if;
 select * into s from public.inbound_lead_settings where workspace_id=p_workspace_id for update;
 if not found then raise exception 'inbound_disabled'; end if;
 if p_action='create_key' then
  if not s.enabled then raise exception 'inbound_disabled'; end if;
  if (p_payload->>'expiresAt')::timestamptz<=now() or (p_payload->>'expiresAt')::timestamptz>now()+interval '1 year' then raise exception 'inbound_invalid_expiry'; end if;
  insert into public.inbound_lead_keys(workspace_id,created_by,label,token_hash,token_prefix,scopes,sources,event_types,expires_at)
  values(p_workspace_id,p_actor_id,p_payload->>'label',p_payload->>'tokenHash',p_payload->>'tokenPrefix',array(select jsonb_array_elements_text(p_payload->'scopes')),array(select jsonb_array_elements_text(p_payload->'sources')),array(select jsonb_array_elements_text(p_payload->'eventTypes')),(p_payload->>'expiresAt')::timestamptz) returning * into k;
  return jsonb_build_object('id',k.id,'prefix',k.token_prefix);

 end if;
 raise exception 'inbound_invalid_action';
end; $$;
revoke all on function public.inbound_admin_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.inbound_admin_command(uuid,uuid,text,jsonb) to service_role;

create function public.inbound_integration_command(p_key_hash text,p_action text,p_lead_id uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare k public.inbound_lead_keys; s public.inbound_lead_settings; l public.inbound_leads; old public.inbound_lead_receipts;
 required_scope text; v_request_key text; result jsonb; duplicate_id uuid;
begin
 select * into k from public.inbound_lead_keys where token_hash=p_key_hash for update;
 if not found or not k.enabled or k.expires_at<=now() then raise exception 'inbound_auth'; end if;
 select * into s from public.inbound_lead_settings where workspace_id=k.workspace_id for share;
 if not s.enabled or not exists(select 1 from public.workspace_members where workspace_id=k.workspace_id and user_id=s.reviewer_user_id and status='active' and department='marketing') then raise exception 'inbound_disabled'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=k.workspace_id and user_id=k.created_by and status='active' and role='owner') then raise exception 'inbound_auth'; end if;
 required_scope:=case p_action when 'create' then 'leads:create' when 'read' then 'leads:read' when 'update' then 'leads:update' when 'event' then 'events:write' else '' end;
 if required_scope='' or not required_scope=any(k.scopes) then raise exception 'inbound_scope'; end if;
 if k.window_started_at>now()-interval '1 minute' and k.window_requests>=120 then raise exception 'inbound_rate'; end if;
 update public.inbound_lead_keys set window_requests=case when window_started_at<=now()-interval '1 minute' then 1 else window_requests+1 end,window_started_at=case when window_started_at<=now()-interval '1 minute' then now() else window_started_at end where id=k.id;
 -- Serialize contact matching and source retries across separate credentials in this workspace.
 perform pg_advisory_xact_lock(hashtextextended(k.workspace_id::text,1701));
 if p_action='create' then
  if not (p_payload->>'source')=any(k.sources) then raise exception 'inbound_scope'; end if;
  select * into l from public.inbound_leads where workspace_id=k.workspace_id and source=p_payload->>'source' and source_lead_id=p_payload->>'sourceLeadId';
  if found then
   if l.initial_payload<>p_payload then raise exception 'inbound_conflict'; end if;
   return jsonb_build_object('leadId',l.id,'created',false,'version',l.version);
  end if;
  select id into duplicate_id from public.inbound_leads where workspace_id=k.workspace_id and (contact_email=p_payload->>'contactEmail' or contact_phone=p_payload->>'contactPhone') order by created_at,id limit 1;
  insert into public.inbound_leads(workspace_id,source,source_lead_id,company_name,contact_name,contact_email,contact_phone,business_type,company_size,need,source_details,consent,initial_payload,duplicate_of)
  values(k.workspace_id,p_payload->>'source',p_payload->>'sourceLeadId',p_payload->>'companyName',p_payload->>'contactName',p_payload->>'contactEmail',p_payload->>'contactPhone',p_payload->>'businessType',p_payload->>'companySize',p_payload->>'need',p_payload->'sourceDetails',p_payload->'consent',p_payload,duplicate_id) returning * into l;
  insert into public.inbound_lead_events(workspace_id,lead_id,key_id,event_type,occurred_at) values(k.workspace_id,l.id,k.id,'lead.received',now());
  return jsonb_build_object('leadId',l.id,'created',true,'version',l.version);
 end if;
 select * into l from public.inbound_leads where workspace_id=k.workspace_id and id=p_lead_id for update;
 if not found then raise exception 'inbound_not_found'; end if;
 if not l.source=any(k.sources) then raise exception 'inbound_scope'; end if;
 if p_action='read' then
  return to_jsonb(l)-'initial_payload'-'workspace_id';
 end if;
 if p_action='event' and not (p_payload->>'type')=any(k.event_types) then raise exception 'inbound_scope'; end if;
 v_request_key:=case when p_action='event' then 'event:'||(p_payload->>'eventId') else 'update:'||(p_payload->>'requestId') end;
 -- Workspace lock makes this check+mutation+receipt atomic even across key rotation.
 select * into old from public.inbound_lead_receipts where workspace_id=k.workspace_id and inbound_lead_receipts.request_key=v_request_key;
 if found then
  if old.payload<>jsonb_build_object('leadId',l.id,'body',p_payload) then raise exception 'inbound_conflict'; end if;
  return old.result||jsonb_build_object('replayed',true);
 end if;
 if p_action='update' then
  if l.status in ('assigned','rejected') or l.contact_stopped or l.human_takeover then raise exception 'inbound_closed'; end if;
  if l.version<>(p_payload->>'expectedVersion')::integer then raise exception 'inbound_stale'; end if;
  update public.inbound_leads set qualification=qualification||(p_payload->'qualification'),version=version+1,updated_at=now() where id=l.id returning * into l;
  insert into public.inbound_lead_events(workspace_id,lead_id,key_id,event_type,occurred_at,details) values(k.workspace_id,l.id,k.id,'qualification.updated',now(),jsonb_build_object('fields',array(select jsonb_object_keys(p_payload->'qualification'))));
 else
  if (p_payload->>'occurredAt')::timestamptz>now()+interval '5 minutes' then raise exception 'inbound_invalid_time'; end if;
  if p_payload->>'type'='contact.opted_out' then
   -- An opt-out never reopens automatically, including when an older event arrives late.
   update public.inbound_leads set contact_stopped=true,version=version+1,updated_at=now() where id=l.id returning * into l;
  elsif p_payload->>'type' in ('demo.booked','trial.registered') then
   update public.inbound_leads set journey_completed=true,version=version+1,updated_at=now() where id=l.id returning * into l;
  elsif p_payload->>'type'='human.takeover' then
   update public.inbound_leads set human_takeover=true,version=version+1,updated_at=now() where id=l.id returning * into l;
  end if;
  update public.inbound_leads set updated_at=now() where id=l.id;
  if l.marketing_lead_id is not null then
   update public.marketing_leads set inbound_context=inbound_context||jsonb_build_object('contactStopped',l.contact_stopped,'humanTakeover',l.human_takeover,'journeyCompleted',l.journey_completed) where id=l.marketing_lead_id and workspace_id=k.workspace_id;
  end if;
  insert into public.inbound_lead_events(workspace_id,lead_id,key_id,event_type,occurred_at,details) values(k.workspace_id,l.id,k.id,p_payload->>'type',(p_payload->>'occurredAt')::timestamptz,p_payload->'details');
 end if;
 result:=jsonb_build_object('leadId',l.id,'version',l.version,'recorded',true);
 insert into public.inbound_lead_receipts(workspace_id,request_key,payload,result) values(k.workspace_id,v_request_key,jsonb_build_object('leadId',l.id,'body',p_payload),result);
 return result;
end; $$;
revoke all on function public.inbound_integration_command(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inbound_integration_command(text,text,uuid,jsonb) to service_role;

create function public.inbound_review_command(p_workspace_id uuid,p_actor_id uuid,p_lead_id uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_catalog as $$
declare s public.inbound_lead_settings; l public.inbound_leads; target uuid; campaign uuid; sales_lead uuid;
begin
 select * into s from public.inbound_lead_settings where workspace_id=p_workspace_id for update;
 if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=p_actor_id and m.status='active' and (m.role='owner' or (s.enabled and m.user_id=s.reviewer_user_id))) then raise exception 'inbound_forbidden'; end if;
 select * into l from public.inbound_leads where workspace_id=p_workspace_id and id=p_lead_id for update;
 if not found then raise exception 'inbound_not_found'; end if;
 if p_payload->>'action'='assign' then
  target:=(p_payload->>'assignedTo')::uuid;
  if l.status='assigned' and l.assigned_to_user_id=target then return jsonb_build_object('leadId',l.id,'marketingLeadId',l.marketing_lead_id,'replayed',true); end if;
 end if;
 if l.version<>(p_payload->>'expectedVersion')::integer then raise exception 'inbound_stale'; end if;
 if l.status='assigned' then raise exception 'inbound_closed'; end if;
 if p_payload->>'action'='review' then
  if p_payload->>'status' not in ('new','in_review','ready','rejected') then raise exception 'inbound_invalid_action'; end if;
  update public.inbound_leads set status=p_payload->>'status',review_note=coalesce(p_payload->>'reviewNote',review_note),version=version+1,updated_at=now() where id=l.id returning * into l;
 else
  if p_payload->>'action'<>'assign' or l.status<>'ready' or length(trim(coalesce(p_payload->>'reviewNote','')))=0 then raise exception 'inbound_not_ready'; end if;
  if not target=any(s.sales_user_ids) or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=target and status='active' and department='sales' and role='sales') then raise exception 'inbound_invalid_sales'; end if;
  campaign:=s.handoff_campaign_id;
  if campaign is null then
   insert into public.marketing_campaigns(workspace_id,owner_id,name,audience,offer,channel,status) values(p_workspace_id,p_actor_id,'Reviewed inbound enquiries','Inbound customers reviewed before sales handover','Demo or product trial','meta','active') returning id into campaign;
   update public.inbound_lead_settings set handoff_campaign_id=campaign where workspace_id=p_workspace_id;
  end if;
  insert into public.marketing_leads(workspace_id,owner_id,campaign_id,company_name,contact_name,contact_email,contact_phone,company_size,notes,assigned_to_user_id,source_inbound_lead_id,inbound_context)
  values(p_workspace_id,coalesce(s.reviewer_user_id,p_actor_id),campaign,l.company_name,l.contact_name,l.contact_email,l.contact_phone,l.company_size,left('Reviewed inbound '||l.source||' enquiry. '||(p_payload->>'reviewNote'),2000),target,l.id,jsonb_build_object('qualification',l.qualification,'need',l.need,'businessType',l.business_type,'source',l.source,'sourceDetails',l.source_details,'consent',l.consent,'contactStopped',l.contact_stopped,'humanTakeover',l.human_takeover)) returning id into sales_lead;
  update public.inbound_leads set status='assigned',assigned_to_user_id=target,marketing_lead_id=sales_lead,review_note=p_payload->>'reviewNote',version=version+1,updated_at=now() where id=l.id returning * into l;
 end if;
 insert into public.inbound_lead_events(workspace_id,lead_id,actor_id,event_type,occurred_at,details) values(p_workspace_id,l.id,p_actor_id,case when l.status='assigned' then 'lead.assigned' else 'lead.reviewed' end,now(),jsonb_build_object('status',l.status,'assignedTo',l.assigned_to_user_id,'note',l.review_note));
 return jsonb_build_object('leadId',l.id,'version',l.version,'marketingLeadId',l.marketing_lead_id);
end; $$;
revoke all on function public.inbound_review_command(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inbound_review_command(uuid,uuid,uuid,jsonb) to service_role;
