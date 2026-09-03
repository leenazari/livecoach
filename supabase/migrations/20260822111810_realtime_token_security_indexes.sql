-- Cover the two foreign-key lookup directions that are not the leading
-- columns of an existing index. These keep account suspension and room
-- revocation efficient without changing any data.
create index if not exists livekit_join_invites_room_idx
  on public.livekit_join_invites (room_id);

create index if not exists livekit_rooms_owner_idx
  on public.livekit_rooms (owner_id);
