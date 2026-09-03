-- Legacy knowledge files predate account-prefixed storage paths. Bind that
-- compatibility access to the original workspace owner explicitly. A later
-- owner or manager must not inherit access merely because their role changes.

insert into public.app_config (
  key,
  value,
  note,
  updated_at,
  workspace_id,
  owner_id,
  visibility
)
select
  'legacy_storage_owner_id',
  wm.user_id::text,
  'Original account permitted to read legacy unprefixed knowledge files',
  now(),
  wm.workspace_id,
  wm.user_id,
  'private'
from public.workspace_members wm
where wm.role = 'owner' and wm.status = 'active'
order by wm.created_at asc
limit 1
on conflict (key) do nothing;
