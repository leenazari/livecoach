"use client";

import { useRef } from "react";

export default function PublicVoiceNotePlayer({
  token,
  senderName,
}: {
  token: string;
  senderName: string;
}) {
  const recorded = useRef(false);
  const recordPlay = () => {
    if (recorded.current) return;
    recorded.current = true;
    void fetch(`/api/listen/${encodeURIComponent(token)}/played`, {
      method: "POST",
      keepalive: true,
    }).catch(() => undefined);
  };

  return (
    <audio
      className="mt-6 w-full"
      controls
      preload="metadata"
      aria-label={`Personal voice message from ${senderName}`}
      onPlay={recordPlay}
      src={`/api/listen/${encodeURIComponent(token)}/audio`}
    >
      Your browser cannot play this audio message.
    </audio>
  );
}
