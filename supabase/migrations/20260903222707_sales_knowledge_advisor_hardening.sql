-- Cover the ownership foreign key for account deletion and maintenance paths.
create index if not exists lessons_owner_id_fkey_idx
  on public.lessons (owner_id);
