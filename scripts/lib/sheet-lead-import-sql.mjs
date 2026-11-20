// Builds one atomic, replay-safe data import from a reviewed plan. It never
// connects to a database. Keep plans and before-images outside the repository.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
export function sheetLeadImportSql(plan) {
  if (!uuid.test(plan.workspaceId) || !uuid.test(plan.actorId) || !Array.isArray(plan.rows) || !plan.rows.length || plan.rows.length > 1000) throw new Error('Invalid import scope');
  for (const row of plan.rows) {
    if (!uuid.test(row.id) || !uuid.test(row.assignedTo) || !row.companyName || !row.sourceRef?.startsWith('google-sheet:') || row.importedLead?.sourceRef !== row.sourceRef || row.importedLead?.version !== 1) throw new Error('Invalid lead plan');
    if (row.existing && (!row.expectedUpdatedAt || !uuid.test(row.expectedOwner))) throw new Error('Existing company needs a before-image');
    for (const contact of row.contacts) if (!uuid.test(contact.id) || !contact.name || (contact.existing && !contact.expectedUpdatedAt)) throw new Error('Invalid contact plan');
    for (const prospect of row.prospects) if (!uuid.test(prospect.id) || !prospect.expectedUpdatedAt) throw new Error('Invalid prospect plan');
  }
  if (new Set(plan.rows.map(r => r.id)).size !== plan.rows.length || new Set(plan.rows.map(r => r.sourceRef)).size !== plan.rows.length) throw new Error('Duplicate company or source identity');
  const payload = literal(plan);
  let delimiter = '$sheet_import$';
  for (let i = 0; payload.includes(delimiter); i++) delimiter = `$sheet_import_${i}$`;
  return `do ${delimiter}
declare
  plan jsonb := ${payload};
  ws uuid := (plan->>'workspaceId')::uuid;
  actor uuid := (plan->>'actorId')::uuid;
  item jsonb; person jsonb; prospect jsonb;
  c public.companies%rowtype; ct public.contacts%rowtype; p public.outreach_prospects%rowtype;
  cid uuid; assignee uuid; contact_ids jsonb; labels text; meta jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(ws::text || ':sheet-lead-import', 0));
  if not exists (select 1 from public.workspace_members m where m.workspace_id=ws and m.user_id=actor and m.status='active' and m.role='owner') then
    raise exception 'Active workspace owner required';
  end if;
  for item in select value from jsonb_array_elements(plan->'rows') loop
    cid := (item->>'id')::uuid; assignee := (item->>'assignedTo')::uuid;
    if not exists (select 1 from public.workspace_members m where m.workspace_id=ws and m.user_id=assignee and m.status='active') then
      raise exception 'Assignee is no longer active';
    end if;
    -- A replay never overwrites later CRM edits, ownership or sent history.
    if exists (select 1 from public.companies x where x.workspace_id=ws and x.attributes #>> '{importedLead,sourceRef}'=item->>'sourceRef') then continue; end if;
    if (item->>'existing')::boolean then
      select * into c from public.companies x where x.id=cid and x.workspace_id=ws for update;
      if not found or c.owner_id is distinct from (item->>'expectedOwner')::uuid or c.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then raise exception 'Company changed since review'; end if;
      if coalesce(c.attributes,'{}'::jsonb) ? 'importedLead' then raise exception 'Company already has another imported lead'; end if;
    else
      if exists (select 1 from public.companies x where x.workspace_id=ws and
        (lower(trim(x.name))=lower(trim(item->>'companyName')) or
         (nullif(item->>'domain','') is not null and (lower(regexp_replace(coalesce(x.domain,''),'^www\\.',''))=item->>'domain' or
          lower(regexp_replace(split_part(regexp_replace(coalesce(x.website,''),'^https?://',''), '/',1),'^www\\.',''))=item->>'domain')))) then raise exception 'A matching company was added since review'; end if;
      insert into public.companies(id,workspace_id,owner_id,name,domain,website,stage,visibility,is_confidential,attributes)
        values(cid,ws,assignee,item->>'companyName',nullif(item->>'domain',''),nullif(item->>'website',''),'New','private',false,'{}'::jsonb) returning * into c;
    end if;
    labels := lower(concat_ws(' | ',c.stage,c.sector,c.profile #>> '{triage,classification}'));
    if c.is_confidential or c.profile->>'internal'='true' or c.profile->>'archived'='true' or labels ~
      ('\\m(invest(or|ment)?|in[ _-]?house|internal|employee|staff|board|adviser|advisor|product[ _-]?trial|vendor|supplier|personal|private)\\M'
       || '|\\m(strategic|major|large|confidential|private)[ _-]?partner(ship)?\\M|\\mpartner(ship)?[ _-]?(strategic|major|large|confidential|private)\\M') then raise exception 'Protected company cannot be imported or shared'; end if;
    contact_ids := '[]'::jsonb;
    for person in select value from jsonb_array_elements(item->'contacts') loop
      if (person->>'existing')::boolean then
        select * into ct from public.contacts x where x.id=(person->>'id')::uuid and x.workspace_id=ws and x.company_id=cid for update;
        if not found or ct.updated_at is distinct from (person->>'expectedUpdatedAt')::timestamptz then raise exception 'Contact changed since review'; end if;
        -- Only fill missing core fields. Keep custom attributes, notes, roles
        -- and existing email addresses intact. Reviewed names can be expanded.
        update public.contacts set name=person->>'name',role=coalesce(nullif(role,''),nullif(person->>'role','')),
          email=coalesce(nullif(email,''),nullif(person->>'email','')),
          attributes=coalesce(attributes,'{}'::jsonb)
            || case when nullif(attributes->>'phone','') is null and nullif(person->>'phone','') is not null then jsonb_build_object('phone',person->>'phone') else '{}'::jsonb end
            || case when nullif(attributes->>'linkedin_url','') is null and nullif(person->>'linkedinUrl','') is not null then jsonb_build_object('linkedin_url',person->>'linkedinUrl') else '{}'::jsonb end,
          updated_at=now() where id=ct.id and workspace_id=ws and company_id=cid;
      else
        if exists (select 1 from public.contacts x where x.workspace_id=ws and x.company_id=cid and
          (lower(trim(x.name))=lower(trim(person->>'name')) or (nullif(person->>'email','') is not null and lower(x.email)=lower(person->>'email')))) then raise exception 'A matching contact was added since review'; end if;
        insert into public.contacts(id,workspace_id,owner_id,company_id,name,role,email,attributes,visibility)
          values((person->>'id')::uuid,ws,c.owner_id,cid,person->>'name',nullif(person->>'role',''),nullif(person->>'email',''),
            jsonb_strip_nulls(jsonb_build_object('phone',nullif(person->>'phone',''),'linkedin_url',nullif(person->>'linkedinUrl',''))),'private');
      end if;
      contact_ids := contact_ids || jsonb_build_array(person->>'id');
    end loop;
    meta := item->'importedLead' || jsonb_build_object('contactIds',contact_ids,'importedAt',now(),'importedBy',actor);
    update public.companies set
      domain=coalesce(nullif(domain,''),nullif(item->>'domain','')),website=coalesce(nullif(website,''),nullif(item->>'website','')),
      attributes=coalesce(attributes,'{}'::jsonb) || jsonb_build_object('importedLead',meta)
        || case when nullif(attributes->>'leadEmail','') is null and nullif(item->>'email','') is not null then jsonb_build_object('leadEmail',item->>'email') else '{}'::jsonb end
        || case when nullif(attributes->>'leadPhone','') is null and nullif(item->>'phone','') is not null then jsonb_build_object('leadPhone',item->>'phone') else '{}'::jsonb end,
      updated_at=now() where id=cid and workspace_id=ws;
    insert into public.team_client_shares(workspace_id,company_id,shared_by_user_id,status,assigned_to_user_id,assigned_by_user_id,assigned_at)
      values(ws,cid,c.owner_id,'active',assignee,actor,now())
      on conflict(workspace_id,company_id) do update set status='active',assigned_to_user_id=excluded.assigned_to_user_id,assigned_by_user_id=excluded.assigned_by_user_id,assigned_at=excluded.assigned_at
      where team_client_shares.status<>'active' or team_client_shares.assigned_to_user_id is distinct from excluded.assigned_to_user_id;
    for prospect in select value from jsonb_array_elements(item->'prospects') loop
      select * into p from public.outreach_prospects x where x.id=(prospect->>'id')::uuid and x.workspace_id=ws for update;
      if not found or p.updated_at is distinct from (prospect->>'expectedUpdatedAt')::timestamptz or
        (p.crm_company_id is not null and p.crm_company_id<>cid) then raise exception 'Prospect changed or has another client'; end if;
      -- Do not move an in-flight or previously sent CRM sequence to a new sender.
      if exists(select 1 from public.outreach_enrolments e where e.prospect_id=p.id) or exists(select 1 from public.outreach_messages m where m.prospect_id=p.id) then raise exception 'Prospect has outreach activity requiring review'; end if;
      update public.outreach_prospects set crm_company_id=cid,assigned_to_user_id=assignee,
        status=case when lower(meta->>'sourceStatus')='not interested' then 'not_interested'
          when coalesce(meta->>'restriction','') ~* 'do not|paused|hold' then 'suppressed'
          when status='imported' and (lower(meta->>'sourceStatus') in ('contacted','demo done','no response') or
            coalesce(meta->>'emailHistory','') ~* '^\\s*(sent\\s+\\d|email\\s+\\d+\\s*:\\s*\\d)') then 'contacted' else status end,
        suppression_reason=case when coalesce(meta->>'restriction','')<>'' then meta->>'restriction' else suppression_reason end,
        source_metadata=coalesce(source_metadata,'{}'::jsonb) || jsonb_build_object('leadImportSourceRef',item->>'sourceRef'),
        updated_at=now() where id=p.id and workspace_id=ws;
    end loop;
  end loop;
end;
${delimiter};`;
}
