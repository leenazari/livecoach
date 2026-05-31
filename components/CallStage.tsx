"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type Participant,
} from "livekit-client";

type Props = {
  room: string;
  identity: string;
  role: "interviewer" | "candidate";
};

type Person = { label: string; role: string; speaking: boolean };

export default function CallStage({ room: roomName, identity, role }: Props) {
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);

  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);

  const parseRole = (p: Participant) => {
    try {
      return JSON.parse(p.metadata || "{}").role || "";
    } catch {
      return "";
    }
  };

  const refreshPeople = useCallback((speaking: Set<string>) => {
    const r = roomRef.current;
    if (!r) return;
    const list: Person[] = [];
    if (r.localParticipant) {
      list.push({
        label: `${r.localParticipant.identity} (you)`,
        role: parseRole(r.localParticipant),
        speaking: speaking.has(r.localParticipant.identity),
      });
    }
    r.remoteParticipants.forEach((p) => {
      list.push({
        label: p.identity,
        role: parseRole(p),
        speaking: speaking.has(p.identity),
      });
    });
    setPeople(list);
  }, []);

  const join = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomName, identity, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Token request failed");
      if (!data.url) throw new Error("Missing NEXT_PUBLIC_LIVEKIT_URL in env");

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.autoplay = true;
            audioContainerRef.current?.appendChild(el);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach().forEach((el) => el.remove());
        })
        .on(RoomEvent.ParticipantConnected, () => refreshPeople(new Set()))
        .on(RoomEvent.ParticipantDisconnected, () => refreshPeople(new Set()))
        .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          refreshPeople(new Set(speakers.map((s) => s.identity)));
        })
        .on(RoomEvent.Disconnected, () => {
          setJoined(false);
          setPeople([]);
        });

      await room.connect(data.url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setJoined(true);
      refreshPeople(new Set());
    } catch (e: any) {
      setError(e.message || "Could not join call");
    } finally {
      setConnecting(false);
    }
  }, [roomName, identity, role, refreshPeople]);

  const leave = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setJoined(false);
    setPeople([]);
  }, []);

  const toggleMute = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !muted;
    await r.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  useEffect(
    () => () => {
      roomRef.current?.disconnect();
    },
    []
  );

  return (
    <div className="rounded-2xl border border-edge bg-panel/50 p-6">
      <div ref={audioContainerRef} style={{ display: "none" }} />

      {!joined ? (
        <div className="flex flex-col items-start gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
            Room: {roomName} · joining as {role}
          </p>
          <button
            onClick={join}
            disabled={connecting}
            className="rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
          >
            {connecting ? "connecting…" : "● Join call"}
          </button>
          {error && (
            <p className="font-mono text-xs text-rust">⚠︎ {error}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-sage">
              ● connected · {roomName}
            </span>
            <div className="flex gap-2">
              <button
                onClick={toggleMute}
                className={`rounded-full border px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider transition ${
                  muted
                    ? "border-rust text-rust hover:bg-rust hover:text-ink"
                    : "border-edge text-bone hover:border-amber/60"
                }`}
              >
                {muted ? "🔇 unmute" : "🎙 mute"}
              </button>
              <button
                onClick={leave}
                className="rounded-full border border-rust px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
              >
                ■ leave
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            {people.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-edge bg-ink/40 px-4 py-3"
              >
                <span className="font-display text-base text-bone">
                  {p.label}
                </span>
                <span className="flex items-center gap-2">
                  {p.role && (
                    <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-muted">
                      {p.role}
                    </span>
                  )}
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      p.speaking ? "rec-dot bg-sage" : "bg-edge"
                    }`}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="font-mono text-[0.65rem] text-muted">
            Green dot = currently speaking. This is Stage A — call + audio only.
            Transcription and coaching come next.
          </p>
        </div>
      )}
    </div>
  );
}
