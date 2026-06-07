"use client";
// FIRST LINE MARKER (component): components/MeetStage.tsx  — "use client" + JSX
// Drop-in alternative to CallStage for Google Meet calls. Same callback
// contract (onFinalTranscript / onCandidateTurnEnd) so the console pipeline -
// cues, running summary, intent %, scorecard - works unchanged. The transcript
// arrives from the Railway worker websocket (Recall.ai -> worker -> here).
import { useCallback, useEffect, useRef, useState } from "react";

const WORKER_WS =
  "wss://livecoach-meet-worker-production.up.railway.app/ws";

type Props = {
  room: string;
  onFinalTranscript: (role: string, text: string) => void;
  onCandidateTurnEnd: () => void;
};

type Speaker = { name: string; lastRole: string };

// How we decide a candidate "turn" ended (so cues/summary fire):
const PAUSE_MS = 1600; // they stopped talking
const CHECKPOINT_EVERY = 4; // ...or mid-monologue, every N finalised chunks

export default function MeetStage({
  room,
  onFinalTranscript,
  onCandidateTurnEnd,
}: Props) {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [botId, setBotId] = useState("");
  const [status, setStatus] = useState("not connected");
  const [wsState, setWsState] = useState<"off" | "connecting" | "on" | "error">(
    "off"
  );
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [coach, setCoach] = useState<string | null>(null);

  // refs so the long-lived ws handler always sees current values / callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const coachRef = useRef<string | null>(null);
  const onFinalRef = useRef(onFinalTranscript);
  const onTurnEndRef = useRef(onCandidateTurnEnd);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkCountRef = useRef(0);
  const sawCandidateRef = useRef(false);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);
  useEffect(() => {
    onTurnEndRef.current = onCandidateTurnEnd;
  }, [onCandidateTurnEnd]);
  useEffect(() => {
    coachRef.current = coach;
  }, [coach]);

  // host -> "You" by default; a tapped coach name overrides. Everyone else is
  // the person being coached.
  const mapRole = useCallback((speaker: string, recallRole: string) => {
    const c = coachRef.current;
    if (c) return speaker === c ? "interviewer" : "candidate";
    return recallRole === "host" ? "interviewer" : "candidate";
  }, []);

  const fireTurnEnd = useCallback(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    chunkCountRef.current = 0;
    if (sawCandidateRef.current) {
      sawCandidateRef.current = false;
      onTurnEndRef.current();
    }
  }, []);

  const handleUtterance = useCallback(
    (speaker: string, recallRole: string, text: string) => {
      if (!text) return;
      const role = mapRole(speaker, recallRole);

      // remember this speaker (for the "who is You?" picker), default coach=host
      setSpeakers((prev) => {
        if (prev.some((s) => s.name === speaker)) return prev;
        return [...prev, { name: speaker, lastRole: recallRole }];
      });
      if (!coachRef.current && recallRole === "host" && speaker) {
        coachRef.current = speaker;
        setCoach(speaker);
      }

      onFinalRef.current(role, text);

      if (role === "candidate") {
        sawCandidateRef.current = true;
        chunkCountRef.current += 1;
        // mid-monologue checkpoint: don't make a long talker wait
        if (chunkCountRef.current >= CHECKPOINT_EVERY) {
          chunkCountRef.current = 0;
          onTurnEndRef.current();
        }
        // restart the pause timer - fires when they actually stop
        if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = setTimeout(() => {
          pauseTimerRef.current = null;
          chunkCountRef.current = 0;
          if (sawCandidateRef.current) {
            sawCandidateRef.current = false;
            onTurnEndRef.current();
          }
        }, PAUSE_MS);
      } else {
        // coach spoke -> the candidate's turn is over
        fireTurnEnd();
      }
    },
    [mapRole, fireTurnEnd]
  );

  // pull anything already captured for this room (refresh recovery)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/meet/backfill?session=${encodeURIComponent(room)}`
        );
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled || !Array.isArray(d.utterances)) return;
        for (const u of d.utterances) {
          const role = mapRole(u.speaker || "", u.role || "");
          onFinalRef.current(role, (u.text || "").trim());
        }
      } catch {
        /* no backfill is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, mapRole]);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const ws = new WebSocket(`${WORKER_WS}?session=${encodeURIComponent(room)}`);
    wsRef.current = ws;
    setWsState("connecting");
    ws.onopen = () => setWsState("on");
    ws.onerror = () => setWsState("error");
    ws.onclose = () => setWsState("off");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "utterance") {
          handleUtterance(msg.speaker || "", msg.role || "", msg.text || "");
        }
      } catch {
        /* ignore */
      }
    };
  }, [room, handleUtterance]);

  // open the socket as soon as we're in the call; clean up on unmount
  useEffect(() => {
    connect();
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  async function sendBot() {
    if (!meetingUrl.trim()) return;
    setStatus("sending bot...");
    try {
      const r = await fetch("/api/meet/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl: meetingUrl.trim(), sessionId: room }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus(
          "error: " + (d.error || r.status) + (d.detail ? " - " + d.detail : "")
        );
        return;
      }
      setBotId(d.botId);
      setStatus("bot joining the meeting");
      if (wsState !== "on") connect();
    } catch (e: any) {
      setStatus("error: " + e.message);
    }
  }

  async function stopBot() {
    if (!botId) return;
    setStatus("removing bot...");
    try {
      const r = await fetch("/api/meet/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });
      const d = await r.json();
      setStatus(r.ok ? "bot removed" : "stop error: " + (d.error || r.status));
      if (r.ok) setBotId("");
    } catch (e: any) {
      setStatus("error: " + e.message);
    }
  }

  const dot =
    wsState === "on"
      ? "bg-sage"
      : wsState === "connecting"
      ? "bg-amber"
      : "bg-rust";

  return (
    <div className="grid gap-4 rounded-2xl border border-edge bg-panel/50 p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
          Google Meet
        </p>
        <span className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {wsState === "on" ? "live" : wsState}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="https://meet.google.com/abc-defg-hij"
          className="min-w-[260px] flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-sm text-bone"
        />
        <button
          onClick={sendBot}
          disabled={!meetingUrl.trim()}
          className="rounded-full border border-amber/60 bg-amber/15 px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
        >
          Send bot
        </button>
        <button
          onClick={stopBot}
          disabled={!botId}
          className="rounded-full border border-edge px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted transition hover:text-bone disabled:opacity-40"
        >
          Stop bot
        </button>
      </div>

      <p className="font-mono text-[0.6rem] text-muted">{status}</p>

      {speakers.length > 0 && (
        <div className="border-t border-edge/50 pt-3">
          <p className="mb-2 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted">
            Who is you? (tap to correct)
          </p>
          <div className="flex flex-wrap gap-2">
            {speakers.map((s) => {
              const isCoach = coach === s.name;
              return (
                <button
                  key={s.name}
                  onClick={() => setCoach(s.name)}
                  className={`rounded-full border px-3 py-1 font-mono text-[0.62rem] transition ${
                    isCoach
                      ? "border-amber bg-amber/15 text-amber"
                      : "border-edge text-muted hover:text-bone"
                  }`}
                >
                  {s.name || "(unnamed)"} {isCoach ? "= You" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
