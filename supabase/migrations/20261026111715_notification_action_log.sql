-- One human action, one canonical note, one transaction. No new activity store.
-- This function is service-only and rechecks membership and record scope inside
-- the transaction. The HTTP route supplies actor/workspace from verified auth.
alter table public.outreach_events drop constraint outreach_events_kind_check;
alter table public.outreach_events add constraint outreach_events_kind_check check (kind in (
  'queued','researched','drafted','approved','sent','reply','positive_reply','objection','later','referral',
  'unsubscribe','meeting_booked','booking_link_shared','crm_created','learning_promoted','safety_override',
  'handover_review','manual_call','manual_call_interpreted','voice_script_approved','voice_generated',
  'voice_played','linkedin_enrolled','linkedin_connection_sent','linkedin_connection_accepted',
  'linkedin_message_sent','sendpilot_status','failed','notification_action'
));

create or replace function public.record_notification_action_service(
  p_actor uuid, p_workspace uuid, p_notification uuid, p_request uuid,
  p_mode text, p_note text default '', p_channel text default 'note',
  p_complete boolean default true, p_next_action text default '', p_due_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  n public.crm_notifications%rowtype;
  t public.tasks%rowtype;
  c public.companies%rowtype;
  p public.outreach_prospects%rowtype;
  o public.opportunities%rowtype;
  previous public.client_context%rowtype;
  v_company uuid; v_prospect uuid; v_workstream uuid; v_opportunity uuid;
  v_task uuid; v_next_task uuid; v_call uuid; v_context uuid := gen_random_uuid();
  v_ids uuid[]; v_cover boolean; v_shared boolean; v_reply_at timestamptz;
  v_now timestamptz := now(); v_payload jsonb; v_receipt jsonb;
  v_source text; v_content text; v_labels text; v_skipped boolean := false; v_clear_next boolean := false;
begin
  if p_actor is null or p_workspace is null or p_notification is null or p_request is null
    or p_mode is null or p_mode not in ('done','log')
    or p_channel is null or p_channel not in ('note','phone','email','linkedin','video_call','in_person','other')
    or p_complete is null or p_note is null or p_next_action is null
    or length(p_note) > 4000 or length(p_next_action) > 600
    or (p_mode = 'log' and length(btrim(p_note)) = 0)
    or (p_mode = 'done' and (not p_complete or p_note <> '' or p_next_action <> '' or p_due_at is not null or p_channel <> 'note'))
    or (p_due_at is not null and (not isfinite(p_due_at) or length(btrim(p_next_action)) = 0)) then
    raise exception 'Invalid action details' using errcode = '22023';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id = p_workspace
    and m.user_id = p_actor and m.status = 'active' for share;
  if not found then raise exception 'An active workspace account is required' using errcode = '42501'; end if;
  select w.team_lead_cover_enabled into v_cover from public.workspaces w where w.id = p_workspace for share;
  select * into n from public.crm_notifications x where x.id = p_notification
    and x.workspace_id = p_workspace and x.user_id = p_actor for update;
  if not found then raise exception 'Notification not found' using errcode = 'P0002'; end if;
  if n.kind not in ('important_email','outreach_reply','lead_assigned','work_assigned') then
    raise exception 'Open this notification in its original channel' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object('mode',p_mode,'note',btrim(p_note),'channel',p_channel,
    'complete',p_complete,'nextAction',btrim(p_next_action),'dueAt',p_due_at);
  v_source := 'notification_action:' || p_notification::text || ':' || p_request::text;
  select * into previous from public.client_context x where x.owner_id = p_actor
    and x.workspace_id = p_workspace and x.source_ref = v_source;
  if found then
    if previous.metadata->'request' is distinct from v_payload then
      raise exception 'This save was already used with different details. Reopen Log action to add another update' using errcode = '23505';
    end if;
    return previous.metadata->'receipt' || jsonb_build_object('alreadySaved',true);
  end if;
  if n.dismissed_at is not null then raise exception 'This notification has already been handled' using errcode = '23505'; end if;
  if n.source_id is null or n.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'The linked record is unavailable. Open the original item' using errcode = '23505';
  end if;

  -- Never use a name, newest task, or all replies for a client as the target.
  if n.source_table = 'tasks' then
    v_task := n.source_id::uuid;
  elsif n.source_table = 'companies' then v_company := n.source_id::uuid;
  elsif n.source_table = 'outreach_prospects' then v_prospect := n.source_id::uuid;
  elsif n.source_table = 'opportunities' then v_opportunity := n.source_id::uuid;
  else raise exception 'The linked record cannot be updated here' using errcode = '22023';
  end if;
  if n.kind = 'important_email' then
    if n.source_event_key !~ '^important_email:(google|microsoft):.+' then
      raise exception 'The exact email source is unavailable' using errcode = '23505';
    end if;
    select array_agg(x.id) into v_ids from public.tasks x where x.workspace_id = p_workspace
      and x.owner_id = p_actor and x.source = 'important_email_monitor'
      and x.source_ref = substr(n.source_event_key, length('important_email:') + 1);
    if coalesce(cardinality(v_ids),0) <> 1 then
      raise exception 'The exact email task is unavailable. Open the original email' using errcode = '23505';
    end if;
    v_task := v_ids[1];
  elsif n.kind = 'outreach_reply' and v_prospect is not null then
    if n.source_event_key like 'outreach_reply:' || v_prospect::text || ':%' then
      begin
        v_reply_at := substr(n.source_event_key,length('outreach_reply:' || v_prospect::text || ':') + 1)::timestamptz;
        select array_agg(x.id) into v_ids from public.tasks x where x.workspace_id = p_workspace
          and x.owner_id = p_actor and x.source in ('outreach_reply','sendpilot_reply')
          and x.payload->>'outreachProspectId' = v_prospect::text
          and abs(extract(epoch from ((x.payload->>'receivedAt')::timestamptz - v_reply_at))) < 1;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'The exact reply source is unavailable' using errcode = '23505';
      end;
      if coalesce(cardinality(v_ids),0) > 1 then
        raise exception 'More than one task matches this reply. Open the original reply' using errcode = '23505';
      end if;
      v_task := v_ids[1];
    elsif p_complete then
      raise exception 'Open the original reply to complete this delivery alert. Its exact reply task could not be verified' using errcode = '23505';
    end if;
  end if;
  if v_task is not null then
    select * into t from public.tasks x where x.id = v_task and x.workspace_id = p_workspace
      and x.owner_id = p_actor for update;
    if not found then raise exception 'The task is no longer assigned to you' using errcode = '42501'; end if;
    if v_company is not null and t.company_id is distinct from v_company then
      raise exception 'The notification and task refer to different clients' using errcode = '23505';
    end if;
    if v_prospect is not null and t.payload->>'outreachProspectId' is distinct from v_prospect::text then
      raise exception 'The notification and task refer to different leads' using errcode = '23505';
    end if;
    v_company := coalesce(v_company,t.company_id); v_workstream := t.workstream_id;
    if t.payload->>'outreachProspectId' ~* '^[0-9a-f-]{36}$' then
      v_prospect := coalesce(v_prospect,(t.payload->>'outreachProspectId')::uuid);
    end if;
    if t.payload->>'opportunityId' ~* '^[0-9a-f-]{36}$' then
      v_opportunity := coalesce(v_opportunity,(t.payload->>'opportunityId')::uuid);
    end if;
  end if;
  if v_prospect is not null then
    select * into p from public.outreach_prospects x where x.id = v_prospect
      and x.workspace_id = p_workspace and (x.assigned_to_user_id = p_actor
        or (x.assigned_to_user_id is null and x.owner_id = p_actor)) for update;
    if not found then raise exception 'This lead is no longer assigned to you' using errcode = '42501'; end if;
    if v_company is not null and p.crm_company_id is distinct from v_company then
      raise exception 'The lead and task refer to different clients' using errcode = '23505';
    end if;
    v_company := coalesce(v_company,p.crm_company_id);
  end if;
  if v_opportunity is not null then
    select * into o from public.opportunities x where x.id = v_opportunity and x.workspace_id = p_workspace
      and (x.owner_id = p_actor or (x.assigned_to_user_id = p_actor and x.visibility = 'team')) for update;
    if not found then raise exception 'This deal is no longer available to you' using errcode = '42501'; end if;
    if (v_company is not null and o.company_id is distinct from v_company)
      or (v_workstream is not null and o.workstream_id is distinct from v_workstream) then
      raise exception 'The deal and action refer to different client workstreams' using errcode = '23505';
    end if;
    v_company := coalesce(v_company,o.company_id); v_workstream := coalesce(v_workstream,o.workstream_id);
  end if;
  if v_company is not null then
    select * into c from public.companies x where x.id = v_company and x.workspace_id = p_workspace for share;
    if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
    if c.owner_id is distinct from p_actor then
      v_labels := lower(concat_ws(' ',c.stage,c.sector,c.profile->'triage'->>'classification'));
      if c.is_confidential or c.profile->>'internal' = 'true' or v_labels ~
        '\m(invest(or|ment)?|in[ _-]?house|internal|employee|staff|board|adviser|advisor|personal|private|vendor|supplier|product[ _-]?trial)\M|\m(strategic|major|large|confidential)[ _-]?partner(ship)?\M|\mpartner(ship)?[ _-]?(strategic|major|large|confidential)\M' then
        raise exception 'This client is private or protected' using errcode = '42501';
      end if;
      perform 1 from public.team_client_shares s where s.workspace_id = p_workspace and s.company_id = v_company
        and s.assigned_to_user_id = p_actor and s.status = 'active' for share;
      v_shared := found;
      if not coalesce(v_cover,false) and not v_shared then
        raise exception 'You no longer have access to this client' using errcode = '42501';
      end if;
    end if;
    if v_opportunity is null then
      -- A company can have separate projects. Never pick the newest by guess.
      select array_agg(x.id) into v_ids from public.opportunities x where x.workspace_id = p_workspace
        and x.company_id = v_company and x.workstream_id is not distinct from v_workstream
        and x.status = 'open' and x.opportunity_type = 'revenue'
        and (x.owner_id = p_actor or (x.assigned_to_user_id = p_actor and x.visibility = 'team'));
      if cardinality(v_ids) = 1 then
        v_opportunity := v_ids[1];
        select * into o from public.opportunities x where x.id = v_opportunity for update;
        -- Recheck after waiting on a concurrent reassignment.
        if o.workspace_id <> p_workspace or o.status <> 'open' or o.opportunity_type <> 'revenue'
          or o.company_id <> v_company or o.workstream_id is distinct from v_workstream
          or not coalesce((o.owner_id = p_actor or (o.assigned_to_user_id = p_actor and o.visibility = 'team')),false) then
          raise exception 'The deal changed while saving. Try once more' using errcode = '23505';
        end if;
      elsif cardinality(v_ids) > 1 then v_skipped := true;
      end if;
    end if;
  end if;
  if v_workstream is not null then
    perform 1 from public.workstreams w where w.id = v_workstream and w.company_id = v_company
      and w.workspace_id = p_workspace and w.owner_id = p_actor for share;
    if not found then raise exception 'The client workstream is not available to you' using errcode = '42501'; end if;
  end if;

  v_content := case when p_mode = 'done' then 'User marked the action completed. No email send or meeting attendance was verified.'
    else btrim(p_note) end;
  if btrim(p_next_action) <> '' then
    v_content := v_content || E'\n\nNext step agreed by user — ' || btrim(p_next_action)
      || case when p_due_at is null then '' else E'\nDue — ' || p_due_at::text end;
  end if;
  insert into public.client_context (id,workspace_id,owner_id,company_id,workstream_id,kind,title,content,visibility,source_ref,metadata)
    values(v_context,p_workspace,p_actor,v_company,v_workstream,'note',
      case when p_mode = 'done' then 'Completed — ' else 'Action logged — ' end || n.title,
      v_content,'private',v_source,jsonb_build_object('source','notification_action','notificationId',n.id,
        'prospectId',v_prospect,'taskId',v_task,'channel',p_channel,'recordedBy',p_actor,'request',v_payload));
  if p_complete and v_task is not null then
    update public.tasks x set status = 'done', done_at = coalesce(x.done_at,v_now),
      payload = coalesce(x.payload,'{}'::jsonb) || jsonb_build_object('completionContextId',v_context,'completedBy',p_actor,'completionSource','notification_action')
      where x.id = v_task and x.status = 'open';
  end if;
  if btrim(p_next_action) <> '' then
    insert into public.tasks(workspace_id,owner_id,company_id,workstream_id,text,kind,link_kind,status,source,source_ref,fingerprint,payload,due_at,visibility)
      values(p_workspace,p_actor,v_company,v_workstream,btrim(p_next_action),'follow_up',
        case when v_prospect is null then 'client' else 'outreach' end,'open','notification_action',v_source,
        v_source,jsonb_build_object('contextId',v_context,'outreachProspectId',v_prospect,'opportunityId',v_opportunity),p_due_at,'private')
      returning id into v_next_task;
  end if;
  if v_prospect is not null then
    -- Only a reference goes into shared outreach history. The note remains private.
    insert into public.outreach_events(workspace_id,owner_id,prospect_id,kind,metadata,visibility)
      values(p_workspace,p_actor,v_prospect,'notification_action',
        jsonb_build_object('contextId',v_context,'notificationId',n.id,'mode',p_mode,'completed',p_complete),'private');
    update public.outreach_prospects x set updated_at = v_now,
      source_metadata = coalesce(x.source_metadata,'{}'::jsonb) || jsonb_build_object('latest_notification_action',
        jsonb_build_object('contextId',v_context,'at',v_now,'by',p_actor)),
      next_action_at = case when btrim(p_next_action) <> '' then p_due_at else x.next_action_at end
      where x.id = v_prospect;
    -- No sent/replied counters, sequence advancement or suppression changes.
  end if;
  if v_opportunity is not null and o.status = 'open' then
    v_clear_next := p_complete and v_task is not null and btrim(p_next_action) = ''
      and lower(regexp_replace(btrim(coalesce(o.next_action,'')), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(t.text), '\s+', ' ', 'g'));
    update public.opportunities x set last_meaningful_activity_at = v_now,
      next_action = case when btrim(p_next_action) <> '' then btrim(p_next_action) when v_clear_next then null else x.next_action end,
      next_action_due_at = case when btrim(p_next_action) <> '' then p_due_at when v_clear_next then null else x.next_action_due_at end,
      next_action_owner = case when btrim(p_next_action) <> '' or v_clear_next then 'us' else x.next_action_owner end,
      next_action_override = case when btrim(p_next_action) <> '' or v_clear_next then true else x.next_action_override end,
      next_action_override_at = case when btrim(p_next_action) <> '' or v_clear_next then v_now else x.next_action_override_at end,
      last_change_context = jsonb_build_object('sourceType','human','sourceChannel','notification_action',
        'rationale','User recorded a completed action or next step','evidence',jsonb_build_object('contextId',v_context,'actorUserId',p_actor))
      where x.id = v_opportunity;
    -- Lifecycle, win outlook and manually written deal intent are untouched.
  end if;
  if v_company is not null and p_mode = 'log' then
    select x.id into v_call from public.upcoming_calls x where x.workspace_id = p_workspace and x.owner_id = p_actor
      and x.company_id = v_company and x.workstream_id is not distinct from v_workstream
      and x.completed_at is null and x.scheduled_at > v_now order by x.scheduled_at limit 1 for update;
    -- Prep reads the canonical note on demand. Do not overwrite a saved plan.
  end if;
  update public.crm_notifications x set read_at = case when p_complete then coalesce(x.read_at,v_now) else x.read_at end,
    dismissed_at = case when p_complete then v_now else x.dismissed_at end,
    snoozed_until = case when p_complete then null else x.snoozed_until end where x.id = n.id;
  v_receipt := jsonb_build_object('ok',true,'contextId',v_context,'companyId',v_company,'prospectId',v_prospect,
    'taskId',v_task,'nextTaskId',v_next_task,'opportunityId',v_opportunity,'callId',v_call,
    'completed',p_complete,'alreadySaved',false,'pipelineNeedsSelection',v_skipped);
  update public.client_context x set metadata = x.metadata || jsonb_build_object('receipt',v_receipt) where x.id = v_context;
  return v_receipt;
end;
$$;
revoke all on function public.record_notification_action_service(uuid,uuid,uuid,uuid,text,text,text,boolean,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_notification_action_service(uuid,uuid,uuid,uuid,text,text,text,boolean,text,timestamptz) to service_role;
