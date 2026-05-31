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
  onFinalTranscript?: (role: string, text: string) => void;
  onCandidateTurnEnd?: () => void;
};

type Person = { label: string; role: string; speaking: boolean };

export default function CallStage({
  room: roomName,
  identity,
  role,
  onFinalTranscript,
  onCandidateTurnEnd,
}: Props) {
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);

  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);

  const dgWsRef = useRef<WebSocket | null>(null);
  const dgRecRef = useRef<MediaRecorder | null>(null);
  const dgStreamRef = useRef<MediaStream | null>(null);
  const mutedRef = useRef(false); // gates what reaches Deepgram

  const onFinalRef = useRef(onFinalTranscript);
  const onTurnRef = useRef(onCandidateTurnEnd);
  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);
  useEffect(() => {
    onTurnRef.current = onCandidateTurnEnd;
  }, [onCandidateTurnEnd]);

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

  const handleLine = useCallback(
    (lineRole: string, text: string, speechFinal: boolean) => {
      if (!text.trim()) return;
      onFinalRef.current?.(lineRole, text);
      if (lineRole === "candidate" && speechFinal) {
        onTurnRef.current?.();
      }
    },
    []
  );

  const publishTranscript = useCallback(
    (text: string, speechFinal: boolean) => {
      const r = roomRef.current;
      if (!r) return;
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: "transcript", role, text, speechFinal })
      );
      r.localParticipant.publishData(payload, { reliable: true });
    },
    [role]
  );

  const startTranscription = useCallback(async () => {
    try {
      const key = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
      if (!key) {
        console.error("Missing NEXT_PUBLIC_DEEPGRAM_API_KEY");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      dgStreamRef.current = stream;

      const params = new URLSearchParams({
        model: "nova-2",
        smart_format: "true",
        punctuate: "true",
        interim_results: "true",
        endpointing: "300",
        language: "en",
      });

      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params.toString()}`,
        ["token", key]
      );
      dgWsRef.current = ws;

      ws.onopen = () => {
        const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
        dgRecRef.current = rec;
        rec.ondataavailable = (e) => {
          // HARD GATE: while muted, send nothing to Deepgram.
          if (mutedRef.current) return;
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };
        rec.start(250);
      };

      ws.onmessage = (msg) => {
        try {
          // Defensive: ignore anything that arrives while muted.
          if (mutedRef.current) return;
          const data = JSON.parse(msg.data);
          const alt = data?.channel?.alternatives?.[0];
          const text: string = alt?.transcript || "";
          if (!text || !data.is_final) return;
          const speechFinal = !!data.speech_final;
          publishTranscript(text, speechFinal);
          handleLine(role, text, speechFinal);
        } catch {
          /* ignore keepalive frames */
        }
      };

      ws.onerror = (e) => console.error("Deepgram WS error:", e);
    } catch (e) {
      console.error("Transcription start failed:", e);
    }
  }, [role, publishTranscript, handleLine]);

  const stopTranscription = useCallback(() => {
    if (dgRecRef.current?.state === "recording") dgRecRef.current.stop();
    if (dgWsRef.current && dgWsRef.current.readyState === WebSocket.OPEN) {
      dgWsRef.current.send(JSON.stringify({ type: "CloseStream" }));
      dgWsRef.current.close();
    }
    dgStreamRef.current?.getTracks().forEach((t) => t.stop());
    dgRecRef.current = null;
    dgWsRef.current = null;
    dgStreamRef.current = null;
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
        .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg.type === "transcript") {
              handleLine(msg.role, msg.text, !!msg.speechFinal);
            }
          } catch {
            /* ignore */
          }
        })
        .on(RoomEvent.Disconnected, () => {
          setJoined(false);
          setPeople([]);
        });

      await room.connect(data.url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      mutedRef.current = false;
      setMuted(false);
      setJoined(true);
      refreshPeople(new Set());

      startTranscription();
    } catch (e: any) {
      setError(e.message || "Could not join call");
    } finally {
      setConnecting(false);
    }
  }, [roomName, identity, role, refreshPeople, handleLine, startTranscription]);

  const leave = useCallback(async () => {
    stopTranscription();
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setJoined(false);
    setPeople([]);
  }, [stopTranscription]);

  // ONE mute control gating BOTH the call track AND the transcriber.
  const toggleMute = useCallback(async () => {
    const r = roomRef.current;
    const next = !muted;

    // 1. Gate Deepgram FIRST so nothing leaks during the toggle.
    mutedRef.current = next;
    const rec = dgRecRef.current;
    if (rec) {
      if (next && rec.state === "recording") rec.pause();
      else if (!next && rec.state === "paused") rec.resume();
    }

    // 2. Gate the LiveKit call track.
    if (r) await r.localParticipant.setMicrophoneEnabled(!next);

    setMuted(next);
  }, [muted]);

  useEffect(
    () => () => {
      stopTranscription();
      roomRef.current?.disconnect();
    },
    [stopTranscription]
  );

  return (
    <div className="rounded-2xl border border-edge bg-panel/50 p-6">
      <div ref={audioContainerRef} style={{ display: "none" }} />

      {!joined ? (
        <div className="flex flex-col items-start gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
            Room: {roomName} - joining as {role}
          </p>
          <button
            onClick={join}
            disabled={connecting}
            className="rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
          >
            {connecting ? "connecting..." : "Join call"}
          </button>
          {error && <p className="font-mono text-xs text-rust">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-sage">
              connected - {roomName}
            </span>
            <div className="flex gap-2">
              <button
                onClick={toggleMute}
                className={`rounded-full border px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider transition ${
                  muted
                    ? "border-rust bg-rust/10 text-rust hover:bg-rust hover:text-ink"
                    : "border-edge text-bone hover:border-amber/60"
                }`}
              >
                {muted ? "MUTED - tap to talk" : "Mute"}
              </button>
              <button
                onClick={leave}
                className="rounded-full border border-rust px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
              >
                Leave
              </button>
            </div>
          </div>

          {muted && (
            <p className="font-mono text-[0.7rem] text-rust">
              You are muted - nothing is sent to the call or the transcript.
            </p>
          )}

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
        </div>
      )}
    </div>
  );
}
