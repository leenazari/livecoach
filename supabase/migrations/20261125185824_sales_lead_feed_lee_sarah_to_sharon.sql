-- Adam feed owners lee and sarah are assigned to Sharon, alongside sharon. Kamm stays with Kamm.
create or replace function public.intake_sales_lead_service(p_workspace uuid,p_actor uuid,p_lead uuid)
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
  rep:=case when lower(trim(raw.owner)) in ('cam','kam','kamm') then cfg.salespeople[1] when lower(trim(raw.owner)) in ('sharon','lee','sarah') then cfg.salespeople[2] end;
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
