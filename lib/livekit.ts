import { AccessToken } from "livekit-server-sdk";

// Mints a LiveKit access token for a participant to join a room.
// role is stored in participant metadata so the interviewer's client
// can tell who is who when assembling the labelled transcript.
export async function createLiveKitToken(opts: {
  room: string;
  identity: string;
  role: "interviewer" | "candidate";
}) {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity: opts.identity,
      ttl: "2h",
      metadata: JSON.stringify({ role: opts.role }),
    }
  );

  at.addGrant({
    roomJoin: true,
    room: opts.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true, // needed for sharing transcript over the data channel
  });

  // NOTE: in server-sdk v2, toJwt() is async — must be awaited.
  return await at.toJwt();
}
