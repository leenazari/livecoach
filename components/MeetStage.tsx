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
  onFinalTranscript: (role: string, text: string, speaker?: string) => void;
  onCandidateTurnEnd: () => void;
  // Optional controlled meeting URL (entered up in the setup step). Falls back
  // to internal state if not provided.
  meetingUrl?: string;
  onMeetingUrlChange?: (v: string) => void;
};

type Speaker = { name: string; lastRole: string };

// How we decide a candidate "turn" ended (so cues/summary fire):
const PAUSE_MS = 1600; // they stopped talking
const CHECKPOINT_EVERY = 4; // ...or mid-monologue, every N finalised chunks

// Default "You" detection for the POC (single user = Lee). Becomes a per-user
// account setting later. We match by NAME, not the meeting host, because the
// coach often isn't the person who created the Meet.
const COACH_HINTS = ["lee nazari", "l n"];
function looksLikeCoach(name: string) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return COACH_HINTS.some((h) => n === h || n.includes(h));
}

export default function MeetStage({
  room,
  onFinalTranscript,
  onCandidateTurnEnd,
  meetingUrl: meetingUrlProp,
  onMeetingUrlChange,
}: Props) {
  const [meetingUrlInternal, setMeetingUrlInternal] = useState("");
  const meetingUrl = meetingUrlProp ?? meetingUrlInternal;
  const setMeetingUrl = onMeetingUrlChange ?? setMeetingUrlInternal;
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
  // Reconnect + recovery state. The socket can drop mid-call (wifi blip, the
  // tab backgrounding, a worker restart); if it does, no new transcript arrives
  // while the window keeps showing what was already captured - so it silently
  // stops without anyone noticing. These let us reconnect automatically and
  // backfill anything missed, so the capture is never quietly lost.
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false); // true only on intentional teardown (unmount)
  const retryRef = useRef(0); // backoff attempt counter
  const deliveredRef = useRef(0); // how many utterances we've delivered so far
  const sendingRef = useRef(false); // in-flight guard so a double-tap can't send two bots

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
    if (looksLikeCoach(speaker)) return "interviewer";
    return "candidate";
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
      if (!coachRef.current && looksLikeCoach(speaker)) {
        coachRef.current = speaker;
        setCoach(speaker);
      }

      onFinalRef.current(role, text, speaker);
      deliveredRef.current += 1;

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

  // Pull the worker's stored transcript for this room and deliver only the
  // utterances we haven't shown yet (from `start`). The worker keeps the full
  // log, so this both repopulates after a page refresh AND recovers whatever was
  // missed while the socket was down - the transcript is never quietly lost.
  const deliverBackfill = useCallback(
    async (start: number) => {
      try {
        const r = await fetch(
          `/api/meet/backfill?session=${encodeURIComponent(room)}`
        );
        if (!r.ok) return;
        const d = await r.json();
        if (!Array.isArray(d.utterances)) return;
        for (let i = Math.max(0, start); i < d.utterances.length; i++) {
          const u = d.utterances[i];
          const role = mapRole(u.speaker || "", u.role || "");
          onFinalRef.current(role, (u.text || "").trim(), u.speaker);
        }
        if (d.utterances.length > deliveredRef.current)
          deliveredRef.current = d.utterances.length;
      } catch {
        /* no backfill is fine */
      }
    },
    [room, mapRole]
  );

  // On first mount, repopulate from anything already captured (refresh recovery).
  useEffect(() => {
    deliverBackfill(0);
  }, [deliverBackfill]);

  const connect = useCallback(() => {
    closedRef.current = false;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    const ws = new WebSocket(`${WORKER_WS}?session=${encodeURIComponent(room)}`);
    wsRef.current = ws;
    setWsState("connecting");
    ws.onopen = () => {
      setWsState("on");
      retryRef.current = 0;
      // We may have missed utterances while the socket was down - recover them.
      deliverBackfill(deliveredRef.current);
    };
    ws.onerror = () => setWsState("error");
    ws.onclose = () => {
      setWsState("off");
      // Auto-reconnect with backoff unless we're intentionally tearing down. A
      // dropped socket must never silently end the capture mid-call.
      if (closedRef.current) return;
      const delay = Math.min(8000, 800 * Math.pow(2, retryRef.current));
      retryRef.current += 1;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(() => {
        if (!closedRef.current) connect();
      }, delay);
    };
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "utterance") {
          handleUtterance(msg.speaker || "", msg.role || "", msg.text || "");
        }
      } catch {
        /* ignore */
      }
    };
  }, [room, handleUtterance, deliverBackfill]);

  // open the socket as soon as we're in the call; clean up on unmount
  useEffect(() => {
    connect();
    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [connect]);

  async function sendBot() {
    // Guard against a double-tap firing two bots: `disabled` only updates on the
    // next render, so a fast second click can slip through before React catches
    // up. The ref blocks it synchronously, and we never send if a bot is live.
    if (!meetingUrl.trim() || botId || sendingRef.current) return;
    sendingRef.current = true;
    setStatus("sending bot...");
    try {
      const r = await fetch("/api/meet/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl: meetingUrl.trim(), sessionId: room }),
      });
      const d = await r.json();
      if (!r.ok) {
        // Recall.ai out of credit (402) is a billing state, not a code error -
        // give a clear, actionable message and point to the no-bot path instead
        // of a raw API dump.
        const blob = `${d.error || ""} ${d.detail || ""}`.toLowerCase();
        if (
          r.status === 402 ||
          blob.includes("insufficient_credit") ||
          blob.includes("credit balance")
        ) {
          setStatus(
            "Recall.ai is out of bot credits, so the transcriber can't join. Top up your Recall.ai account, or use 'Recap by voice' to run this call without the bot."
          );
          return;
        }
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
    } finally {
      sendingRef.current = false;
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
          Meet / Teams / Zoom
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
          placeholder="Paste Meet / Teams / Zoom link"
          className="min-w-[260px] flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-sm text-bone"
        />
        <button
          onClick={sendBot}
          disabled={!meetingUrl.trim() || !!botId || status === "sending bot..."}
          title={
            botId
              ? "Bot is in the meeting. Stop it before sending another."
              : "Send the bot to join and transcribe"
          }
          className={`rounded-full border px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
            botId
              ? "cursor-default border-sage bg-sage text-ink"
              : "border-amber/60 bg-amber/15 text-amber hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40"
          }`}
        >
          {botId
            ? "● bot sent"
            : status === "sending bot..."
            ? "sending…"
            : "Send bot"}
        </button>
        <button
          onClick={stopBot}
          disabled={!botId}
          title={botId ? "Remove the bot from the meeting" : "No bot is live"}
          className={`rounded-full border px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
            botId
              ? "border-rust bg-rust text-white hover:brightness-110"
              : "border-edge text-muted disabled:cursor-not-allowed disabled:opacity-40"
          }`}
        >
          Stop bot
        </button>
      </div>

      <p className="font-mono text-[0.6rem] text-muted">{status}</p>

      {/* Loud, impossible-to-miss warning when a bot is live but the transcript
          socket is down - this is the moment capture silently stopped before.
          It recovers on its own; the banner just tells you not to trust the
          window or end the call until it's back. */}
      {botId && wsState !== "on" && (
        <div className="rounded-lg border border-rust/60 bg-rust/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-rust">
          {"⚠"} Transcriber disconnected{" "}
          {wsState === "connecting" ? "- reconnecting now" : "- reconnecting"}.
          New speech is not being captured this second. Keep the call open, it
          recovers and backfills what it missed automatically.
        </div>
      )}

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
