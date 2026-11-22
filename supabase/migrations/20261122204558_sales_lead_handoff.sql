-- Server-only source receipts. Existing companies, contacts and opportunities stay canonical.
create table public.sales_lead_connections (
 source text primary key check(source='adam'), workspace_id uuid not null references public.workspaces(id),
 owner_id uuid not null references auth.users(id), salespeople uuid[] not null,
 enabled boolean not null default false, created_at timestamptz not null default now()
);
create table public.sales_lead_sources (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 company_id uuid not null references public.companies(id), source_ref text not null,
 source_lead_id uuid, campaign text, criteria_version text, landing_page_url text,
 activity jsonb not null default '{}', opportunity_id uuid references public.opportunities(id),
 updated_at timestamptz not null default now(), unique(workspace_id,source_ref)
);
create index sales_lead_sources_company on public.sales_lead_sources(workspace_id,company_id);
create index sales_lead_sources_opportunity on public.sales_lead_sources(opportunity_id);
create index sales_lead_sources_lead on public.sales_lead_sources(source_lead_id);
create table public.sales_lead_event_receipts (
 workspace_id uuid not null references public.workspaces(id), event_ref text not null check(length(event_ref) between 1 and 300),
 company_id uuid not null references public.companies(id), source_ref text not null,
 event_type text not null, occurred_at timestamptz not null, created_at timestamptz not null default now(),
 primary key(workspace_id,event_ref)
);
create index sales_lead_event_receipts_company on public.sales_lead_event_receipts(company_id);
alter table public.sales_lead_connections enable row level security;
alter table public.sales_lead_sources enable row level security;
alter table public.sales_lead_event_receipts enable row level security;
revoke all on public.sales_lead_connections,public.sales_lead_sources,public.sales_lead_event_receipts from public,anon,authenticated;
grant all on public.sales_lead_connections,public.sales_lead_sources,public.sales_lead_event_receipts to service_role;

create function public.record_sales_lead_event_service(p_workspace uuid,p_actor uuid,p_company uuid,p_event jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
 member_role text; c public.companies%rowtype; s public.sales_lead_sources%rowtype;
 receipt public.sales_lead_event_receipts%rowtype; opportunity public.opportunities%rowtype;
 rep uuid; event_kind text:=p_event->>'type'; event_key text:=p_event->>'ref'; source_key text:=p_event->>'sourceRef';
 happened timestamptz:=(p_event->>'occurredAt')::timestamptz; blocked boolean; promoted boolean:=false; task_key text;
begin
 select role into member_role from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and status='active';
 if member_role is null then raise exception 'sales_lead_access'; end if;
 if event_kind not in ('page_view','demo_start','demo_completed','reply','positive_reply','meeting_booked','sales_confirmed','opt_out','negative_reply')
 or event_kind is null or happened is null or happened>now()+interval '5 minutes' or coalesce(length(event_key),0) not between 1 and 300
 or coalesce(length(source_key),0) not between 1 and 400 then raise exception 'sales_lead_invalid_event'; end if;
 select * into c from public.companies where workspace_id=p_workspace and id=p_company for update;
 if not found or c.is_confidential or c.profile->>'internal'='true' or c.profile->>'archived'='true'
 or coalesce(c.attributes->'importedLead'->>'version','')<>'1'
 or concat_ws(' ',c.stage,c.sector,c.profile->'triage'->>'classification') ~* '\m(investor|investment|internal|employee|staff|board|adviser|advisor|vendor|supplier|personal|private|product[ _-]?trial|strategic[ _-]?partner(ship)?|major[ _-]?partner(ship)?|large[ _-]?partner(ship)?|confidential[ _-]?partner(ship)?|partner(ship)?[ _-]?strategic|partner(ship)?[ _-]?major|partner(ship)?[ _-]?large|partner(ship)?[ _-]?confidential)\M'
 then raise exception 'sales_lead_access'; end if;
 select assigned_to_user_id into rep from public.team_client_shares where workspace_id=p_workspace and company_id=p_company and status='active';
 if rep is null or (member_role<>'owner' and rep<>p_actor) or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=rep and status='active') then raise exception 'sales_lead_access'; end if;
 select * into s from public.sales_lead_sources where workspace_id=p_workspace and company_id=p_company and source_ref=source_key;
 if not found then
  if coalesce(c.attributes->'importedLead'->>'sourceRef','')<>source_key then raise exception 'sales_lead_source_conflict'; end if;
  insert into public.sales_lead_sources(workspace_id,company_id,source_ref,landing_page_url,campaign,criteria_version)
  values(p_workspace,p_company,source_key,c.attributes->'importedLead'->>'holdingPageUrl',c.attributes->'importedLead'->>'campaign',c.attributes->'importedLead'->>'criteriaVersion') returning * into s;
 end if;
 select * into receipt from public.sales_lead_event_receipts where workspace_id=p_workspace and event_ref=event_key;
 if found then
  if receipt.company_id<>p_company or receipt.event_type<>event_kind or receipt.source_ref<>source_key or (event_kind<>'sales_confirmed' and receipt.occurred_at<>happened) then raise exception 'sales_lead_event_conflict'; end if;
  return jsonb_build_object('ok',true,'replayed',true,'opportunityId',s.opportunity_id);
 end if;
 blocked:=coalesce(c.profile->'pipeline_exclusion'->>'active','false')='true'
 or lower(coalesce(c.attributes->'importedLead'->>'restriction','')) ~ 'do not|unsubscrib|opt.?out|paused|hold|not interested'
 or lower(coalesce(c.attributes->'importedLead'->>'sourceStatus','')) ~ 'do not|unsubscrib|opt.?out|paused|hold|not interested'
 or exists(select 1 from public.sales_lead_sources where workspace_id=p_workspace and company_id=p_company and (activity ? 'opt_out' or activity ? 'negative_reply'));
 insert into public.sales_lead_event_receipts values(p_workspace,event_key,p_company,source_key,event_kind,happened,now());
 if (s.activity->>event_kind) is null or (s.activity->>event_kind)::timestamptz<happened then
  update public.sales_lead_sources set activity=jsonb_set(activity,array[event_kind],to_jsonb(happened)),updated_at=now() where id=s.id;
 end if;
 -- Honour the daemon's exact-email suppression even when it used an older tracking token.
 blocked:=blocked or exists(
  select 1 from public.adam_unsubscribes u where lower(trim(u.email)) in (
   select lower(trim(c.attributes->>'leadEmail')) union select lower(trim(r.dm_email)) from public.adam_pipeline_leads r where r.id=s.source_lead_id union select lower(trim(r.email)) from public.adam_pipeline_leads r where r.id=s.source_lead_id
  )
 ) or exists(
  select 1 from public.adam_pipeline_unsubscribes u where lower(trim(u.email))=lower(trim(c.attributes->>'leadEmail'))
 );
 if event_kind in ('opt_out','negative_reply') then
  update public.companies set attributes=jsonb_set(attributes,'{importedLead,restriction}',to_jsonb(case when event_kind='opt_out' then 'Do not contact: opted out' else 'Not interested: review before contacting' end)),updated_at=now() where id=p_company;
 end if;
 if blocked or event_kind in ('opt_out','negative_reply') then return jsonb_build_object('ok',true,'restricted',true); end if;
 if event_kind in ('positive_reply','meeting_booked','sales_confirmed') then
  select * into opportunity from public.opportunities where workspace_id=p_workspace and company_id=p_company and workstream_id is null and status='open' and opportunity_type='revenue';
  if found and coalesce(opportunity.assigned_to_user_id,opportunity.owner_id)<>rep then raise exception 'sales_lead_owner_conflict'; end if;
  if opportunity.id is null then
   insert into public.opportunities(workspace_id,company_id,owner_id,assigned_to_user_id,visibility,title,status,opportunity_type,pipeline_stage,probability,value,source,surfaced_by_ai,engagement_motion,active_contact_method,last_change_context)
   values(p_workspace,p_company,rep,rep,'team',left(c.name||' sales opportunity',240),'open','revenue','new',0,null,'sales_lead_handoff',false,'cold_outreach_campaign',case when event_kind='meeting_booked' then 'video_call' else 'personal_email' end,
   jsonb_build_object('nonce',gen_random_uuid(),'sourceType',case when event_kind='sales_confirmed' then 'human' else 'system' end,'sourceChannel','sales_lead_handoff','rationale',event_kind,'evidence',jsonb_build_object('sourceRef',source_key,'eventRef',event_key))) returning * into opportunity;
   promoted:=true;
  end if;
  update public.sales_lead_sources set opportunity_id=opportunity.id where id=s.id;
 end if;
 -- Low-intent visits do not generate a speculative deal or repetitive tasks.
 if event_kind in ('reply','demo_completed','positive_reply','meeting_booked','sales_confirmed') then
  task_key:='sales_lead:'||s.id::text||':'||case when event_kind in ('positive_reply','meeting_booked','sales_confirmed') then 'handoff' else event_kind end;
  insert into public.tasks(workspace_id,owner_id,company_id,text,kind,link_kind,source,source_ref,fingerprint,status,visibility,payload)
  values(p_workspace,rep,p_company,left(case when event_kind='meeting_booked' then 'Prepare for the booked meeting with ' when event_kind='reply' then 'Review the reply from ' when event_kind='demo_completed' then 'Follow up on the completed demo with ' else 'Confirm the next sales step with ' end||c.name,500),'next_step','client','sales_lead_handoff',source_key,task_key,'open','private',jsonb_build_object('eventType',event_kind,'occurredAt',happened,'campaign',s.campaign,'opportunityId',opportunity.id))
  on conflict(owner_id,fingerprint) do nothing;
  if opportunity.id is not null then
   insert into public.crm_notifications(workspace_id,user_id,kind,title,body,href,source_table,source_id,source_event_key)
   values(p_workspace,rep,'lead_assigned',left('Sales follow-up: '||c.name,160),'A confirmed sales signal is linked to your pipeline. Review the next step.','/crm/revenue','opportunities',opportunity.id::text,task_key)
   on conflict(user_id,source_event_key) do nothing;
  end if;
 end if;
 return jsonb_build_object('ok',true,'created',promoted,'opportunityId',opportunity.id);
end $$;
revoke all on function public.record_sales_lead_event_service(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_sales_lead_event_service(uuid,uuid,uuid,jsonb) to service_role;

-- Count in Postgres; only a bounded safe projection reaches Brain. No transcripts or mail bodies.
create function public.sales_lead_report_service(p_workspace uuid,p_actor uuid,p_owner uuid default null,p_campaign text default null,p_since timestamptz default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare r text; answer jsonb;
begin
 select role into r from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and status='active';
 if r is null or (p_owner is not null and p_owner<>p_actor and r<>'owner') then raise exception 'sales_lead_access'; end if;
 with eligible as (
  select c.id,left(c.name,160) as name,a.assigned_to_user_id as rep,c.attributes->'importedLead' as lead,
   coalesce((select jsonb_object_agg(k,v) from public.sales_lead_sources s cross join lateral jsonb_each_text(s.activity) e(k,v) where s.workspace_id=p_workspace and s.company_id=c.id),'{}'::jsonb) as activity,
   (select o.id from public.opportunities o where o.workspace_id=p_workspace and o.company_id=c.id and o.opportunity_type='revenue' and o.status='open' and o.workstream_id is null and (r='owner' or coalesce(o.assigned_to_user_id,o.owner_id)=p_actor) limit 1) as opportunity_id
  from public.companies c join public.team_client_shares a on a.company_id=c.id and a.workspace_id=c.workspace_id and a.status='active'
  where c.workspace_id=p_workspace and not c.is_confidential and c.attributes @> '{"importedLead":{"version":1}}'
   and coalesce(c.profile->>'internal','false')<>'true' and coalesce(c.profile->>'archived','false')<>'true'
   and concat_ws(' ',c.stage,c.sector,c.profile->'triage'->>'classification') !~* '\m(investor|investment|internal|employee|staff|board|adviser|advisor|vendor|supplier|personal|private|product[ _-]?trial|strategic[ _-]?partner(ship)?|major[ _-]?partner(ship)?|large[ _-]?partner(ship)?|confidential[ _-]?partner(ship)?|partner(ship)?[ _-]?strategic|partner(ship)?[ _-]?major|partner(ship)?[ _-]?large|partner(ship)?[ _-]?confidential)\M'
   and (r='owner' or a.assigned_to_user_id=p_actor) and (p_owner is null or a.assigned_to_user_id=p_owner)
   and (p_campaign is null or c.attributes->'importedLead'->>'campaign'=p_campaign or exists(select 1 from public.sales_lead_sources s where s.workspace_id=p_workspace and s.company_id=c.id and s.campaign=p_campaign))
   and (p_since is null or c.created_at>=p_since)
 ), summary as (select count(*) as total,count(*) filter(where opportunity_id is not null) as in_pipeline,
 count(*) filter(where activity ? 'page_view') as page_visitors,count(*) filter(where activity ? 'demo_start') as demo_starts,
 count(*) filter(where activity ? 'demo_completed') as demo_completions,count(*) filter(where activity ? 'reply' or activity ? 'positive_reply') as replies,
 count(*) filter(where activity ? 'positive_reply') as positive_replies,count(*) filter(where activity ? 'meeting_booked') as bookings,
 count(*) filter(where coalesce(lead->>'campaign','')='' and not exists(select 1 from public.sales_lead_sources s where s.workspace_id=p_workspace and s.company_id=eligible.id and s.campaign is not null)) as campaign_unknown from eligible)
 select jsonb_build_object('summary',(select to_jsonb(summary) from summary),'recent',(select coalesce(jsonb_agg(x),'[]') from (select id,name,rep,opportunity_id,activity,left(coalesce(lead->>'campaign',(select min(s.campaign) from public.sales_lead_sources s where s.workspace_id=p_workspace and s.company_id=eligible.id)),100) as campaign from eligible order by lead->>'importedAt' desc nulls last,id limit 12) x),'limit',12,'dateBasis','Company creation time','eventCaveat','Page view and demo start do not prove a completed demo. Missing campaign attribution is unknown.') into answer;
 return answer;
end $$;
revoke all on function public.sales_lead_report_service(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sales_lead_report_service(uuid,uuid,uuid,text,timestamptz) to service_role;

create function public.intake_sales_lead_service(p_workspace uuid,p_actor uuid,p_lead uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare cfg public.sales_lead_connections%rowtype; raw public.adam_pipeline_leads%rowtype;
 c public.companies%rowtype; rep uuid; person uuid; domain_key text; matches uuid[]; address text; source_key text:='adam:'||p_lead::text; source_id uuid;
begin
 select * into cfg from public.sales_lead_connections where source='adam' and workspace_id=p_workspace and owner_id=p_actor and enabled;
 if not found or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role='owner' and status='active') then raise exception 'sales_lead_access'; end if;
 if cardinality(cfg.salespeople)<>2 or (select count(*) from public.workspace_members where workspace_id=p_workspace and user_id=any(cfg.salespeople) and role='sales' and status='active')<>2 then raise exception 'sales_lead_salespeople'; end if;
 select * into raw from public.adam_pipeline_leads where id=p_lead;
 if not found or raw.bank_status is distinct from 'qualified' or (raw.emailed_at is null and not exists(select 1 from public.adam_pipeline_send_log where lead_id=p_lead and status='sent')) then raise exception 'sales_lead_not_sent'; end if;
 select id,company_id into source_id,c.id from public.sales_lead_sources where workspace_id=p_workspace and source_ref=source_key;
 if found then return jsonb_build_object('ok',true,'existing',true,'companyId',c.id); end if;
 if nullif(trim(raw.company),'') is null then raise exception 'sales_lead_company_review'; end if;
 domain_key:=lower(regexp_replace(regexp_replace(regexp_replace(trim(coalesce(nullif(raw.domain,''),raw.website,'')),'^https?://','','i'),'^www\.','','i'),'[/#:?].*$',''));
 if domain_key !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' or domain_key in ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','live.com','aol.com') then raise exception 'sales_lead_domain_review'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||':'||domain_key,0));
 select company_id into c.id from public.sales_lead_sources where workspace_id=p_workspace and source_ref=source_key;
 if found then return jsonb_build_object('ok',true,'existing',true,'companyId',c.id); end if;
 select array_agg(id) into matches from public.companies where workspace_id=p_workspace and lower(regexp_replace(regexp_replace(regexp_replace(trim(coalesce(nullif(domain,''),website,'')),'^https?://','','i'),'^www\.','','i'),'[/#:?].*$',''))=domain_key;
 if cardinality(matches)>1 then raise exception 'sales_lead_domain_review'; end if;
 if cardinality(matches)=1 then
  select * into c from public.companies where id=matches[1] and workspace_id=p_workspace for update;
  if c.is_confidential or c.profile->>'internal'='true' or c.profile->>'archived'='true' or concat_ws(' ',c.stage,c.sector,c.profile->'triage'->>'classification') ~* '\m(investor|investment|internal|employee|staff|board|adviser|advisor|vendor|supplier|personal|private|product[ _-]?trial|strategic[ _-]?partner(ship)?|major[ _-]?partner(ship)?|large[ _-]?partner(ship)?|confidential[ _-]?partner(ship)?|partner(ship)?[ _-]?strategic|partner(ship)?[ _-]?major|partner(ship)?[ _-]?large|partner(ship)?[ _-]?confidential)\M' then raise exception 'sales_lead_protected'; end if;
  select assigned_to_user_id into rep from public.team_client_shares where workspace_id=p_workspace and company_id=c.id and status='active';
  -- Existing assignment is authoritative, including historical Lee-owned leads.
  if rep is null then raise exception 'sales_lead_assignment_review'; end if;
 else
  rep:=case when lower(trim(raw.owner)) in ('cam','kam','kamm') then cfg.salespeople[1] when lower(trim(raw.owner))='sharon' then cfg.salespeople[2] end;
  if rep is null then select candidate into rep from unnest(cfg.salespeople) candidate order by (select count(*) from public.team_client_shares where workspace_id=p_workspace and status='active' and assigned_to_user_id=candidate),candidate limit 1; end if;
  insert into public.companies(workspace_id,owner_id,name,domain,website,sector,stage,visibility,attributes)
   values(p_workspace,p_actor,left(raw.company,250),domain_key,raw.website,raw.sector,'Prospect','private','{}') returning * into c;
  insert into public.team_client_shares(workspace_id,company_id,status,shared_by_user_id,assigned_to_user_id,assigned_by_user_id,assigned_at)
   values(p_workspace,c.id,'active',p_actor,rep,p_actor,now());
 end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=rep and status='active') then raise exception 'sales_lead_assignment_review'; end if;
 address:=lower(trim(coalesce(nullif(raw.dm_email,''),raw.email,'')));
 if address<>'' and address !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then raise exception 'sales_lead_email_review'; end if;
 if address<>'' then
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||':email:'||address,0));
  select array_agg(id) into matches from public.contacts where workspace_id=p_workspace and (lower(trim(email))=address or attributes->'emails' @> to_jsonb(array[address]));
  if cardinality(matches)>1 then raise exception 'sales_lead_email_review'; end if;
  if cardinality(matches)=1 then
   select id into person from public.contacts where id=matches[1] and workspace_id=p_workspace and company_id=c.id;
   if person is null then raise exception 'sales_lead_email_review'; end if;
  elsif nullif(trim(raw.contact_full),'') is not null and address !~ '^(info|hello|sales|office|admin|contact|support|reception)@' then
   insert into public.contacts(workspace_id,owner_id,company_id,name,role,email,visibility,attributes)
    values(p_workspace,rep,c.id,left(raw.contact_full,200),raw.role,address,'private',jsonb_build_object('phone',raw.phone,'linkedin_url',raw.linkedin_url,'emails',jsonb_build_array(address))) returning id into person;
  end if;
 end if;
 -- Preserve the existing sheet attribution and private CRM content. New source attribution has its own receipt.
 if coalesce(c.attributes->'importedLead'->>'version','')<>'1' then
  update public.companies set attributes=attributes||jsonb_build_object('importedLead',jsonb_build_object('version',1,'sourceRef',source_key,'importedAt',now(),'sourceDate',coalesce(raw.emailed_at,now()),'sourceStatus','contacted','holdingPageUrl',raw.demo_link,'signal',raw.signal,'signalUrl',raw.signal_link,'campaign',raw.campaign,'criteriaVersion',raw.criteria_set_version,'contactIds',case when person is null then '[]'::jsonb else jsonb_build_array(person) end),'leadEmail',address,'leadPhone',raw.phone),updated_at=now() where id=c.id;
 end if;
 if person is not null and coalesce(c.attributes->'importedLead'->>'version','')='1' and not coalesce(c.attributes->'importedLead'->'contactIds','[]'::jsonb) @> jsonb_build_array(person) then
  update public.companies set attributes=jsonb_set(attributes,'{importedLead,contactIds}',coalesce(attributes->'importedLead'->'contactIds','[]'::jsonb)||jsonb_build_array(person)),updated_at=now() where id=c.id;
 end if;
 insert into public.sales_lead_sources(workspace_id,company_id,source_ref,source_lead_id,campaign,criteria_version,landing_page_url)
  values(p_workspace,c.id,source_key,p_lead,raw.campaign,raw.criteria_set_version,raw.demo_link);
 return jsonb_build_object('ok',true,'companyId',c.id,'assignedTo',rep);
end $$;
revoke all on function public.intake_sales_lead_service(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.intake_sales_lead_service(uuid,uuid,uuid) to service_role;

create table public.sales_lead_reviews (
 workspace_id uuid not null references public.workspaces(id), source_lead_id uuid not null,
 reason text not null, retry_after timestamptz not null default now()+interval '1 day',
 primary key(workspace_id,source_lead_id)
);
alter table public.sales_lead_reviews enable row level security;
revoke all on public.sales_lead_reviews from public,anon,authenticated;
grant all on public.sales_lead_reviews to service_role;
create function public.pending_sales_leads_service(p_workspace uuid,p_actor uuid)
returns table(id uuid) language sql stable security invoker set search_path=pg_catalog as $$
 select l.id from public.adam_pipeline_leads l
 where l.bank_status='qualified' and (l.emailed_at is not null or exists(select 1 from public.adam_pipeline_send_log m where m.lead_id=l.id and m.status='sent'))
 and exists(select 1 from public.sales_lead_connections cfg join public.workspace_members wm on wm.workspace_id=cfg.workspace_id and wm.user_id=cfg.owner_id and wm.status='active' and wm.role='owner' where cfg.source='adam' and cfg.enabled and cfg.workspace_id=p_workspace and cfg.owner_id=p_actor)
 and not exists(select 1 from public.sales_lead_sources s where s.workspace_id=p_workspace and s.source_lead_id=l.id)
 and not exists(select 1 from public.sales_lead_reviews r where r.workspace_id=p_workspace and r.source_lead_id=l.id and r.retry_after>now())
 order by l.created_at,l.id limit 25
$$;
revoke all on function public.pending_sales_leads_service(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pending_sales_leads_service(uuid,uuid) to service_role;

-- Cross-owner identity checks disclose no private record. Trigger execution only;
-- ordinary callers cannot invoke the privileged lookup directly.
create function public.guard_crm_company_domain() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare domain_key text;
begin
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id and new.domain is not distinct from old.domain and new.website is not distinct from old.website then return new; end if;
 domain_key:=lower(regexp_replace(regexp_replace(regexp_replace(trim(coalesce(nullif(new.domain,''),new.website,'')),'^https?://','','i'),'^www\.','','i'),'[/#:?].*$',''));
 if domain_key='' then return new; end if;
 if domain_key !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' then raise exception 'crm_company_domain_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':'||domain_key,0));
 if exists(select 1 from public.companies c where c.workspace_id=new.workspace_id and c.id<>new.id and lower(regexp_replace(regexp_replace(regexp_replace(trim(coalesce(nullif(c.domain,''),c.website,'')),'^https?://','','i'),'^www\.','','i'),'[/#:?].*$',''))=domain_key) then raise exception 'crm_company_domain_conflict'; end if;
 new.domain:=domain_key; return new;
end $$;
revoke all on function public.guard_crm_company_domain() from public,anon,authenticated;
create trigger guard_crm_company_domain before insert or update of workspace_id,domain,website on public.companies for each row execute function public.guard_crm_company_domain();
create index contacts_workspace_primary_email_idx on public.contacts(workspace_id,lower(trim(email))) where email is not null;
create index contacts_additional_emails_idx on public.contacts using gin((attributes->'emails'));
create function public.guard_crm_contact_emails() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare address text; addresses text[];
begin
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id and new.email is not distinct from old.email and new.attributes->'emails' is not distinct from old.attributes->'emails' then return new; end if;
 if new.attributes ? 'emails' and jsonb_typeof(new.attributes->'emails')<>'array' then raise exception 'crm_contact_email_invalid'; end if;
 if jsonb_array_length(coalesce(new.attributes->'emails','[]'))>10 or exists(select 1 from jsonb_array_elements(coalesce(new.attributes->'emails','[]')) e where jsonb_typeof(e)<>'string') then raise exception 'crm_contact_email_invalid'; end if;
 select array_agg(distinct lower(trim(e)) order by lower(trim(e))) into addresses from (select new.email as e union all select jsonb_array_elements_text(coalesce(new.attributes->'emails','[]'))) x where coalesce(trim(e),'')<>'';
 foreach address in array coalesce(addresses,array[]::text[]) loop
  if length(address)>254 or address !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then raise exception 'crm_contact_email_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||':email:'||address,0));
  if exists(select 1 from public.contacts c where c.workspace_id=new.workspace_id and c.id<>new.id and (lower(trim(c.email))=address or c.attributes->'emails' @> to_jsonb(array[address]))) then raise exception 'crm_contact_email_conflict'; end if;
 end loop;
 new.email:=nullif(lower(trim(new.email)),'');
 if new.attributes ? 'emails' then new.attributes:=jsonb_set(new.attributes,'{emails}',to_jsonb(coalesce(addresses,array[]::text[]))); end if;
 return new;
end $$;
revoke all on function public.guard_crm_contact_emails() from public,anon,authenticated;
create trigger guard_crm_contact_emails before insert or update of workspace_id,email,attributes on public.contacts for each row execute function public.guard_crm_contact_emails();
