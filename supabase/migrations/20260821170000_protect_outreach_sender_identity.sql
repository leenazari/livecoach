-- Outreach sender identity is security-sensitive. A user may edit their own
-- ordinary profile fields, but the visible Gmail sender is set only by the
-- trusted activation flow after checking that user's connected mailbox.

create or replace function public.protect_livecoach_outreach_sender_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.outreach_sender_name is distinct from old.outreach_sender_name
    or new.outreach_sender_email is distinct from old.outreach_sender_email then
    raise exception 'outreach sender identity must be changed through the verified account setup';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_outreach_sender_identity on public.profiles;
create trigger profiles_protect_outreach_sender_identity
  before update of outreach_sender_name, outreach_sender_email
  on public.profiles
  for each row execute function public.protect_livecoach_outreach_sender_identity();

revoke execute on function public.protect_livecoach_outreach_sender_identity()
  from public, anon, authenticated;
