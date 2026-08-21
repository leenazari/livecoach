-- Invited colleagues complete account and Google setup before they become
-- active workspace members. Onboarding members cannot read team CRM rows.

alter table public.workspace_members
  drop constraint if exists workspace_members_status_check;
alter table public.workspace_members
  add constraint workspace_members_status_check
  check (status in ('active', 'onboarding', 'suspended', 'removed'));

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = lower(u.email), updated_at = now()
from auth.users u
where u.id = p.user_id
  and p.email is distinct from lower(u.email);

create or replace function public.accept_livecoach_invitation(
  invitation_token_hash text,
  invited_user_id uuid,
  requested_display_name text
)
returns table (
  workspace_id uuid,
  member_role text,
  member_status text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  invitation public.workspace_invitations%rowtype;
  invited_email text;
  clean_name text;
begin
  if invitation_token_hash is null or length(invitation_token_hash) <> 64 then
    raise exception 'invalid invitation token';
  end if;

  select lower(email) into invited_email
  from auth.users
  where id = invited_user_id;

  if invited_email is null then
    raise exception 'authenticated invitation user was not found';
  end if;

  select * into invitation
  from public.workspace_invitations wi
  where wi.token_hash = invitation_token_hash
    and wi.status = 'pending'
    and (wi.expires_at is null or wi.expires_at > now())
  for update;

  if invitation.id is null then
    raise exception 'invitation is invalid or has expired';
  end if;
  if lower(invitation.email) <> invited_email then
    raise exception 'invitation belongs to a different email address';
  end if;

  clean_name := nullif(trim(coalesce(requested_display_name, '')), '');
  insert into public.profiles (user_id, email, display_name, updated_at)
  values (invited_user_id, invited_email, clean_name, now())
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    invited_by,
    updated_at
  ) values (
    invitation.workspace_id,
    invited_user_id,
    invitation.role,
    'onboarding',
    invitation.invited_by,
    now()
  )
  on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        status = 'onboarding',
        invited_by = excluded.invited_by,
        updated_at = now();

  update public.workspace_invitations
  set status = 'accepted',
      accepted_by = invited_user_id,
      accepted_at = now(),
      updated_at = now()
  where id = invitation.id;

  insert into public.access_audit_events (
    workspace_id,
    actor_user_id,
    source,
    action,
    target_table,
    target_id,
    next_scope,
    metadata
  ) values (
    invitation.workspace_id,
    invited_user_id,
    'human',
    'workspace_invitation_accepted',
    'workspace_members',
    invited_user_id::text,
    jsonb_build_object('role', invitation.role, 'status', 'onboarding'),
    jsonb_build_object('invitationId', invitation.id)
  );

  return query
  select invitation.workspace_id, invitation.role, 'onboarding'::text;
end;
$$;

revoke all on function public.accept_livecoach_invitation(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_livecoach_invitation(text, uuid, text)
  to service_role;
