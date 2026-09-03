alter table public.crm_chat_attachments
  drop constraint if exists crm_chat_attachments_file_size_check;

alter table public.crm_chat_attachments
  add constraint crm_chat_attachments_file_size_check
  check (file_size is null or file_size between 1 and 20971520);

create unique index if not exists crm_chat_attachments_storage_path_unique_idx
  on public.crm_chat_attachments (storage_path)
  where storage_path is not null;

do $$
begin
  update storage.buckets
  set file_size_limit = 20971520
  where id = 'crm-chat-files'
    and public = false;

  if not found then
    raise exception 'Private CRM chat file bucket was not found';
  end if;
end;
$$;
