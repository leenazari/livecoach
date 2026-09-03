-- Private, workspace-scoped CRM chat. Conversations are visible only to their
-- explicit members. Shared CRM cards contain a deliberately small snapshot and
-- never promote the underlying private record, calls, transcripts or mailbox.

create table public.crm_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('direct', 'group')),
  name text check (name is null or length(name) between 1 and 80),
  direct_key text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  last_message_id uuid,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'direct' and direct_key is not null and name is null)
    or (kind = 'group' and direct_key is null and name is not null)
  )
);

create unique index crm_chat_conversations_direct_key_idx
  on public.crm_chat_conversations (workspace_id, direct_key)
  where direct_key is not null;
create index crm_chat_conversations_workspace_updated_idx
  on public.crm_chat_conversations (workspace_id, updated_at desc);

create table public.crm_chat_conversation_members (
  conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_by_user_id uuid not null references auth.users(id) on delete restrict,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index crm_chat_members_user_workspace_idx
  on public.crm_chat_conversation_members (user_id, workspace_id, conversation_id);

create table public.crm_chat_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  client_nonce uuid not null,
  body text not null default '' check (length(body) <= 5000),
  created_at timestamptz not null default now(),
  unique (conversation_id, sender_user_id, client_nonce)
);

create index crm_chat_messages_conversation_created_idx
  on public.crm_chat_messages (conversation_id, created_at desc);
create index crm_chat_messages_sender_rate_idx
  on public.crm_chat_messages (workspace_id, sender_user_id, created_at desc);

alter table public.crm_chat_conversations
  add constraint crm_chat_conversations_last_message_fkey
  foreign key (last_message_id) references public.crm_chat_messages(id)
  on delete set null;

create table public.crm_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.crm_chat_conversations(id) on delete cascade,
  message_id uuid not null references public.crm_chat_messages(id) on delete cascade,
  kind text not null check (
    kind in ('file', 'company', 'contact', 'opportunity', 'crm_link')
  ),
  target_id uuid,
  title text not null check (length(title) between 1 and 220),
  subtitle text check (subtitle is null or length(subtitle) <= 500),
  href text check (href is null or (href like '/%' and length(href) <= 500)),
  snapshot jsonb not null default '{}'::jsonb check (
    jsonb_typeof(snapshot) = 'object'
    and octet_length(snapshot::text) <= 12000
  ),
  storage_path text check (
    storage_path is null or length(storage_path) between 1 and 700
  ),
  file_name text check (file_name is null or length(file_name) between 1 and 220),
  mime_type text check (mime_type is null or length(mime_type) <= 160),
  file_size bigint check (file_size is null or file_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  check (
    (kind = 'file' and storage_path is not null and file_name is not null and file_size is not null)
    or (kind <> 'file' and storage_path is null and file_name is null and file_size is null)
  )
);

create index crm_chat_attachments_message_idx
  on public.crm_chat_attachments (message_id, created_at);
create index crm_chat_attachments_target_idx
  on public.crm_chat_attachments (workspace_id, kind, target_id)
  where target_id is not null;

create table public.crm_chat_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id uuid not null references public.crm_chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error text check (error is null or length(error) <= 1000),
  attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index crm_chat_email_deliveries_status_idx
  on public.crm_chat_email_deliveries (workspace_id, status, created_at);

alter table public.crm_chat_conversations enable row level security;
alter table public.crm_chat_conversation_members enable row level security;
alter table public.crm_chat_messages enable row level security;
alter table public.crm_chat_attachments enable row level security;
alter table public.crm_chat_email_deliveries enable row level security;

revoke all on public.crm_chat_conversations from public, anon, authenticated;
revoke all on public.crm_chat_conversation_members from public, anon, authenticated;
revoke all on public.crm_chat_messages from public, anon, authenticated;
revoke all on public.crm_chat_attachments from public, anon, authenticated;
revoke all on public.crm_chat_email_deliveries from public, anon, authenticated;

grant select on public.crm_chat_conversations to authenticated;
grant select on public.crm_chat_conversation_members to authenticated;
grant select on public.crm_chat_messages to authenticated;
grant select on public.crm_chat_attachments to authenticated;
grant all on public.crm_chat_conversations to service_role;
grant all on public.crm_chat_conversation_members to service_role;
grant all on public.crm_chat_messages to service_role;
grant all on public.crm_chat_attachments to service_role;
grant all on public.crm_chat_email_deliveries to service_role;

-- Members may prove only their own conversation membership directly. Server
-- routes list the other participants after rechecking the same workspace.
create policy "Users read their own chat memberships"
  on public.crm_chat_conversation_members for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = crm_chat_conversation_members.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Conversation members read conversations"
  on public.crm_chat_conversations for select to authenticated
  using (
    exists (
      select 1 from public.crm_chat_conversation_members cm
      where cm.conversation_id = crm_chat_conversations.id
        and cm.workspace_id = crm_chat_conversations.workspace_id
        and cm.user_id = (select auth.uid())
    )
  );

create policy "Conversation members read messages"
  on public.crm_chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.crm_chat_conversation_members cm
      where cm.conversation_id = crm_chat_messages.conversation_id
        and cm.workspace_id = crm_chat_messages.workspace_id
        and cm.user_id = (select auth.uid())
    )
  );

create policy "Conversation members read attachments"
  on public.crm_chat_attachments for select to authenticated
  using (
    exists (
      select 1 from public.crm_chat_conversation_members cm
      where cm.conversation_id = crm_chat_attachments.conversation_id
        and cm.workspace_id = crm_chat_attachments.workspace_id
        and cm.user_id = (select auth.uid())
    )
  );

-- Conversation creation is atomic, checks every selected user against active
-- workspace membership, and deduplicates direct conversations.
create or replace function public.create_crm_chat_conversation_service(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_kind text,
  p_name text,
  p_member_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  member_ids uuid[];
  active_members integer;
  clean_name text := nullif(trim(coalesce(p_name, '')), '');
  key_value text;
  conversation_row public.crm_chat_conversations%rowtype;
  was_existing boolean := false;
begin
  if p_kind not in ('direct', 'group') then
    raise exception 'Choose a direct message or group conversation';
  end if;

  select array_agg(member_id order by member_id)
  into member_ids
  from (
    select distinct member_id
    from unnest(coalesce(p_member_ids, array[]::uuid[]) || array[p_actor_user_id])
      as selected(member_id)
    where member_id is not null
  ) members;

  if cardinality(member_ids) < 2 or cardinality(member_ids) > 50 then
    raise exception 'Choose between 2 and 50 active workspace members';
  end if;
  if p_kind = 'direct' and cardinality(member_ids) <> 2 then
    raise exception 'A direct conversation must contain exactly two people';
  end if;
  if p_kind = 'group' and (clean_name is null or length(clean_name) > 80) then
    raise exception 'Give the group a name of up to 80 characters';
  end if;

  select count(*) into active_members
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = any(member_ids)
    and wm.status = 'active';
  if active_members <> cardinality(member_ids) then
    raise exception 'Every chat participant must be an active member of this workspace';
  end if;

  if p_kind = 'direct' then
    key_value := array_to_string(member_ids, ':');
    select * into conversation_row
    from public.crm_chat_conversations conversation
    where conversation.workspace_id = p_workspace_id
      and conversation.direct_key = key_value
    limit 1;
    if found then
      was_existing := true;
    else
      begin
        insert into public.crm_chat_conversations (
          workspace_id, kind, direct_key, created_by_user_id
        ) values (
          p_workspace_id, 'direct', key_value, p_actor_user_id
        ) returning * into conversation_row;
      exception when unique_violation then
        select * into conversation_row
        from public.crm_chat_conversations conversation
        where conversation.workspace_id = p_workspace_id
          and conversation.direct_key = key_value
        limit 1;
        was_existing := true;
      end;
    end if;
  else
    insert into public.crm_chat_conversations (
      workspace_id, kind, name, created_by_user_id
    ) values (
      p_workspace_id, 'group', clean_name, p_actor_user_id
    ) returning * into conversation_row;
  end if;

  insert into public.crm_chat_conversation_members (
    conversation_id, workspace_id, user_id, added_by_user_id
  )
  select conversation_row.id, p_workspace_id, member_id, p_actor_user_id
  from unnest(member_ids) as selected(member_id)
  on conflict (conversation_id, user_id) do nothing;

  if not was_existing then
    insert into public.access_audit_events (
      workspace_id,
      actor_user_id,
      source,
      action,
      target_table,
      target_id,
      next_scope
    ) values (
      p_workspace_id,
      p_actor_user_id,
      'human',
      'crm_chat_conversation_created',
      'crm_chat_conversations',
      conversation_row.id::text,
      jsonb_build_object(
        'kind', p_kind,
        'memberCount', cardinality(member_ids)
      )
    );
  end if;

  return jsonb_build_object(
    'id', conversation_row.id,
    'existing', was_existing,
    'kind', conversation_row.kind,
    'name', conversation_row.name
  );
end;
$$;

-- Message and attachment rows commit together. A client nonce makes a retried
-- browser request idempotent and the rate limit stops accidental message loops.
create or replace function public.post_crm_chat_message_service(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_client_nonce uuid,
  p_body text,
  p_attachments jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  clean_body text := trim(coalesce(p_body, ''));
  clean_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  attachment jsonb;
  existing_message public.crm_chat_messages%rowtype;
  saved_message public.crm_chat_messages%rowtype;
begin
  if not exists (
    select 1
    from public.crm_chat_conversation_members cm
    join public.workspace_members wm
      on wm.workspace_id = cm.workspace_id
     and wm.user_id = cm.user_id
     and wm.status = 'active'
    where cm.conversation_id = p_conversation_id
      and cm.workspace_id = p_workspace_id
      and cm.user_id = p_actor_user_id
  ) then
    raise exception 'Conversation membership is required';
  end if;
  if length(clean_body) > 5000 then
    raise exception 'Messages are limited to 5000 characters';
  end if;
  if jsonb_typeof(clean_attachments) <> 'array'
    or jsonb_array_length(clean_attachments) > 6 then
    raise exception 'Choose up to 6 valid attachments';
  end if;
  if clean_body = '' and jsonb_array_length(clean_attachments) = 0 then
    raise exception 'Write a message or add something to share';
  end if;

  select * into existing_message
  from public.crm_chat_messages message
  where message.conversation_id = p_conversation_id
    and message.sender_user_id = p_actor_user_id
    and message.client_nonce = p_client_nonce;
  if found then
    return jsonb_build_object(
      'id', existing_message.id,
      'createdAt', existing_message.created_at,
      'existing', true
    );
  end if;

  if (
    select count(*)
    from public.crm_chat_messages message
    where message.workspace_id = p_workspace_id
      and message.sender_user_id = p_actor_user_id
      and message.created_at > now() - interval '1 minute'
  ) >= 60 then
    raise exception 'Chat is temporarily rate limited. Wait a minute and try again';
  end if;

  insert into public.crm_chat_messages (
    id, workspace_id, conversation_id, sender_user_id, client_nonce, body
  ) values (
    p_message_id, p_workspace_id, p_conversation_id, p_actor_user_id,
    p_client_nonce, clean_body
  ) returning * into saved_message;

  for attachment in select value from jsonb_array_elements(clean_attachments)
  loop
    insert into public.crm_chat_attachments (
      workspace_id, conversation_id, message_id, kind, target_id, title,
      subtitle, href, snapshot, storage_path, file_name, mime_type, file_size
    ) values (
      p_workspace_id,
      p_conversation_id,
      saved_message.id,
      attachment ->> 'kind',
      nullif(attachment ->> 'targetId', '')::uuid,
      attachment ->> 'title',
      nullif(attachment ->> 'subtitle', ''),
      nullif(attachment ->> 'href', ''),
      coalesce(attachment -> 'snapshot', '{}'::jsonb),
      nullif(attachment ->> 'storagePath', ''),
      nullif(attachment ->> 'fileName', ''),
      nullif(attachment ->> 'mimeType', ''),
      nullif(attachment ->> 'fileSize', '')::bigint
    );

    if attachment ->> 'kind' in ('company', 'contact') then
      insert into public.access_audit_events (
        workspace_id,
        actor_user_id,
        source,
        action,
        target_table,
        target_id,
        metadata
      ) values (
        p_workspace_id,
        p_actor_user_id,
        'human',
        'crm_record_shared_in_chat',
        case when attachment ->> 'kind' = 'contact'
          then 'contacts' else 'companies' end,
        attachment ->> 'targetId',
        jsonb_build_object(
          'conversationId', p_conversation_id,
          'messageId', saved_message.id
        )
      );
    end if;
  end loop;

  update public.crm_chat_conversations
  set last_message_id = saved_message.id,
      last_message_at = saved_message.created_at,
      updated_at = saved_message.created_at
  where id = p_conversation_id
    and workspace_id = p_workspace_id;

  update public.crm_chat_conversation_members
  set unread_count = unread_count + 1
  where conversation_id = p_conversation_id
    and workspace_id = p_workspace_id
    and user_id <> p_actor_user_id;

  return jsonb_build_object(
    'id', saved_message.id,
    'createdAt', saved_message.created_at,
    'existing', false
  );
end;
$$;

revoke execute on function public.create_crm_chat_conversation_service(
  uuid, uuid, text, text, uuid[]
) from public, anon, authenticated;
revoke execute on function public.post_crm_chat_message_service(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_crm_chat_conversation_service(
  uuid, uuid, text, text, uuid[]
) to service_role;
grant execute on function public.post_crm_chat_message_service(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;

-- Reuse LiveCoach's existing notification channel for chat. The receipt never
-- contains the message body, contact details or file names.
alter table public.crm_notifications
  drop constraint if exists crm_notifications_kind_check,
  add constraint crm_notifications_kind_check check (
    kind in ('outreach_reply', 'lead_assigned', 'chat_message')
  ),
  drop constraint if exists crm_notifications_source_table_check,
  add constraint crm_notifications_source_table_check check (
    source_table in (
      'outreach_prospects', 'opportunities', 'companies', 'crm_chat_messages'
    )
  );

alter table public.crm_notification_preferences
  add column if not exists chat_alerts boolean not null default true,
  add column if not exists chat_email_enabled boolean not null default true;

create or replace function livecoach_private.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  sender_name text;
  conversation_name text;
begin
  select coalesce(nullif(trim(profile.display_name), ''), 'A teammate')
  into sender_name
  from public.profiles profile
  where profile.user_id = new.sender_user_id;
  sender_name := coalesce(sender_name, 'A teammate');

  select case
    when conversation.kind = 'group' then conversation.name
    else sender_name
  end
  into conversation_name
  from public.crm_chat_conversations conversation
  where conversation.id = new.conversation_id
    and conversation.workspace_id = new.workspace_id;

  insert into public.crm_notifications (
    workspace_id, user_id, kind, title, body, href, source_table, source_id,
    source_event_key, created_at
  )
  select
    new.workspace_id,
    member.user_id,
    'chat_message',
    left('New message from ' || sender_name, 160),
    left('Open ' || coalesce(conversation_name, 'your CRM chat') ||
      ' in LiveCoach to read it securely.', 1000),
    '/crm/chat?conversation=' || new.conversation_id::text,
    'crm_chat_messages',
    new.id::text,
    'chat_message:' || new.id::text,
    new.created_at
  from public.crm_chat_conversation_members member
  join public.workspace_members wm
    on wm.workspace_id = member.workspace_id
   and wm.user_id = member.user_id
   and wm.status = 'active'
  where member.conversation_id = new.conversation_id
    and member.workspace_id = new.workspace_id
    and member.user_id <> new.sender_user_id
  on conflict (user_id, source_event_key) do nothing;

  return new;
end;
$$;

create trigger crm_chat_messages_notify_members
  after insert on public.crm_chat_messages
  for each row execute function livecoach_private.notify_chat_message();

revoke execute on function livecoach_private.notify_chat_message()
  from public, anon, authenticated;
grant execute on function livecoach_private.notify_chat_message()
  to service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'crm-chat-files',
  'crm-chat-files',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]::text[]
) on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.crm_chat_conversations is
  'Private workspace chat conversations visible only to explicitly selected members.';
comment on table public.crm_chat_attachments is
  'Private files and deliberately limited CRM record snapshots shared into one conversation.';
comment on table public.crm_chat_email_deliveries is
  'Idempotent best-effort email notification receipts. Message content is never copied into email.';
