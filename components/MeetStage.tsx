"use client";
// FIRST LINE MARKER (component): components/MeetStage.tsx  — "use client" + JSX
// Drop-in alternative to CallStage for Google Meet calls. Same callback
// contract (onFinalTranscript / onCandidateTurnEnd) so the console pipeline -
// cues, running summary, intent %, scorecard - works unchanged. The transcript
// arrives from the Railway worker websocket (Recall.ai -> worker -> here).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CALL_SILENCE_WARNING_MS,
  callSilenceRemainingMs,
} from "@/lib/call-silence";

type Props = {
  room: string;
  onFinalTranscript: (role: string, text: string, speaker?: string, historical?: boolean) => void;
  onCandidateTurnEnd: () => void;
  onSessionRecovered: (sessionId: string, live: boolean) => void;
  // Optional controlled meeting URL (entered up in the setup step). Falls back
  // to internal state if not provided.
  meetingUrl?: string;
  onMeetingUrlChange?: (v: string) => void;
  upcomingId?: string | null;
  // Incremented by the parent when the user presses the single Start call
  // action. This lets one button start the workspace and send the notetaker.
  startRequest?: number;
  // Uses the parent's canonical end-and-summary path. The Meet component only
  // decides that five quiet minutes have elapsed after real speech began.
  onSilenceTimeout: () => void;
};

type Speaker = { name: string; lastRole: string };
type StreamAccess = {
  token: string;
  expiresAt: string;
  workerWs: string;
  botName: string;
  coachHints: string[];
  teamHints: string[];
};

type ProviderBotState = {
  code: string;
  subCode: string;
  phase:
    | "scheduled"
    | "joining"
    | "waiting_room"
    | "in_call_not_recording"
    | "recording"
    | "ended"
    | "failed"
    | "unknown";
  message: string;
  terminal: boolean;
  endedAt: string | null;
  changedAt: string | null;
  joined: boolean;
  recording: boolean;
};

// How we decide a candidate "turn" ended (so cues/summary fire):
const PAUSE_MS = 1600; // they stopped talking
const CHECKPOINT_EVERY = 4; // ...or mid-monologue, every N finalised chunks
// Mid-call capture stall: transcript was flowing, then went silent for this
// long while the bot is still "in". Usually the notetaker dropped, was removed,
// or lost audio - the exact failure that once read as a healthy green light
// because a single early line had already latched the on-air state true.
const CAPTURE_STALE_MS = 90000;
// A short browser or network wobble is normal, especially when a tab wakes
// from the background. Do not alarm the coach unless the live display has
// remained disconnected continuously for long enough to be actionable.
const WS_RECONNECT_WARNING_GRACE_MS = 8000;

function transcriptIdentity(timestamp: string, speaker: string, text: string) {
  const time = Date.parse(timestamp);
  // Postgres returns +00:00 while the worker sends Z for the same instant.
  return JSON.stringify([Number.isFinite(time) ? time : timestamp, speaker, text.trim()]);
}

// Each account receives its own coach aliases from its private profile. We
// match by name rather than meeting host because the coach is not always the
// person who created the calendar event.
function looksLikeCoach(name: string, coachHints: string[]) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return coachHints.some((hint) => {
    const h = hint.trim().toLowerCase();
    return !!h && (n === h || n.includes(h));
  });
}

export default function MeetStage({
  room,
  onFinalTranscript,
  onCandidateTurnEnd,
  onSessionRecovered,
  meetingUrl: meetingUrlProp,
  onMeetingUrlChange,
  upcomingId = null,
  startRequest = 0,
  onSilenceTimeout,
}: Props) {
  const [meetingUrlInternal, setMeetingUrlInternal] = useState("");
  const meetingUrl = meetingUrlProp ?? meetingUrlInternal;
  const setMeetingUrl = onMeetingUrlChange ?? setMeetingUrlInternal;
  const [botId, setBotId] = useState("");
  const [recovering, setRecovering] = useState(true);
  const [streamReady, setStreamReady] = useState(false);
  const [botName, setBotName] = useState("Your LiveCoach Notetaker");
  const [status, setStatus] = useState("checking for an existing notetaker...");
  const [providerState, setProviderState] =
    useState<ProviderBotState | null>(null);
  // Honest join state. transcribing = real audio has come through (the bot is
  // genuinely in the room), joinWarn = the watchdog fired without any transcript.
  const [transcribing, setTranscribing] = useState(false);
  const [joinWarn, setJoinWarn] = useState(false);
  // Capture started then went quiet for too long while the bot is still live.
  const [captureStalled, setCaptureStalled] = useState(false);
  const [wsState, setWsState] = useState<"off" | "connecting" | "on" | "error">(
    "off"
  );
  const [showReconnectWarning, setShowReconnectWarning] = useState(false);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [coach, setCoach] = useState<string | null>(null);

  // refs so the long-lived ws handler always sees current values / callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const coachRef = useRef<string | null>(null);
  const onFinalRef = useRef(onFinalTranscript);
  const onTurnEndRef = useRef(onCandidateTurnEnd);
  const onRecoveredRef = useRef(onSessionRecovered);
  const liveCaptureRef = useRef(false);
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
  const deliveredKeysRef = useRef(new Set<string>());
  const sendingRef = useRef(false); // in-flight guard so a double-tap can't send two bots
  const connectingRef = useRef(false);
  const connectionAttemptRef = useRef(0);
  const botIdRef = useRef(""); // synchronous mirror of botId (closures + retry)
  const streamAccessRef = useRef<StreamAccess | null>(null);
  const accessPromiseRef = useRef<Promise<StreamAccess> | null>(null);
  const coachHintsRef = useRef<string[]>([]);
  const teamHintsRef = useRef<string[]>([]);
  const roomRef = useRef(room);
  const joinWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUtterAtRef = useRef(0); // when the last utterance landed (stall check)
  const silenceEndRequestedRef = useRef(false);
  const silenceCheckInFlightRef = useRef(false);
  const onSilenceTimeoutRef = useRef(onSilenceTimeout);
  const [silenceRemainingMs, setSilenceRemainingMs] = useState<number | null>(
    null
  );

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);
  useEffect(() => {
    onTurnEndRef.current = onCandidateTurnEnd;
  }, [onCandidateTurnEnd]);
  useEffect(() => {
    onRecoveredRef.current = onSessionRecovered;
  }, [onSessionRecovered]);
  useEffect(() => {
    onSilenceTimeoutRef.current = onSilenceTimeout;
  }, [onSilenceTimeout]);
  useEffect(() => {
    coachRef.current = coach;
  }, [coach]);

  // host -> "You" by default; a tapped coach name overrides. Everyone else is
  // the person being coached.
  const mapRole = useCallback((speaker: string, recallRole: string) => {
    const c = coachRef.current;
    if (c && speaker === c) return "interviewer";
    if (looksLikeCoach(speaker, coachHintsRef.current)) return "interviewer";
    if (looksLikeCoach(speaker, teamHintsRef.current)) return "teammate";
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
    (speaker: string, recallRole: string, text: string, timestamp?: string) => {
      if (!text) return;
      // The worker broadcasts and persists the same timestamp. Deduplicate by
      // that identity so speech arriving during backfill is neither repeated
      // nor counted as one of the older lines we still need to recover.
      if (timestamp) {
        const key = transcriptIdentity(timestamp, speaker, text);
        if (deliveredKeysRef.current.has(key)) return;
        deliveredKeysRef.current.add(key);
      }
      // First real transcript proves the bot is actually IN the meeting and
      // hearing audio - the honest "on air" signal, not merely that a bot was
      // requested. Clears the join watchdog and any stall warning.
      if (joinWatchdogRef.current) {
        clearTimeout(joinWatchdogRef.current);
        joinWatchdogRef.current = null;
      }
      setTranscribing(true);
      setJoinWarn(false);
      setStatus("notetaker is in the meeting and transcribing");
      lastUtterAtRef.current = Date.now();
      silenceEndRequestedRef.current = false;
      setSilenceRemainingMs(null);
      setCaptureStalled(false);
      const role = mapRole(speaker, recallRole);

      // remember this speaker (for the "who is You?" picker), default coach=host
      setSpeakers((prev) => {
        if (prev.some((s) => s.name === speaker)) return prev;
        return [...prev, { name: speaker, lastRole: recallRole }];
      });
      if (
        !coachRef.current &&
        looksLikeCoach(speaker, coachHintsRef.current)
      ) {
        coachRef.current = speaker;
        setCoach(speaker);
      }

      onFinalRef.current(role, text, speaker);

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
  // utterances we haven't shown yet. The worker keeps the full
  // log, so this both repopulates after a page refresh AND recovers whatever was
  // missed while the socket was down - the transcript is never quietly lost.
  const deliverBackfill = useCallback(
    async () => {
      try {
        const r = await fetch(
          `/api/meet/backfill?session=${encodeURIComponent(room)}`
        );
        if (!r.ok) return false;
        const d = await r.json();
        if (closedRef.current || roomRef.current !== room) return false;
        if (!Array.isArray(d.utterances)) return false;
        // A live socket can deliver a new line while older speech is loading.
        // A count alone would then skip an unseen old line. Stable identities
        // let overlapping backfills and socket messages converge safely.
        let recoveredCount = 0;
        let recoveredCandidate = false;
        for (let i = 0; i < d.utterances.length; i++) {
          const u = d.utterances[i];
          const text = (u.text || "").trim();
          const key = transcriptIdentity(u.ts || `stored-${i}`, u.speaker || "", text);
          if (deliveredKeysRef.current.has(key)) continue;
          deliveredKeysRef.current.add(key);
          const role = mapRole(u.speaker || "", u.role || "");
          onFinalRef.current(role, text, u.speaker, true);
          recoveredCount++;
          if (role === "candidate") recoveredCandidate = true;
        }
        // A reconnect can backfill speech that arrived while this tab was
        // asleep. Reset the local clock when that happens so recovered speech
        // can never be mistaken for five minutes of silence.
        if (recoveredCount > 0) {
          lastUtterAtRef.current = Date.now();
          silenceEndRequestedRef.current = false;
          setSilenceRemainingMs(null);
          if (liveCaptureRef.current) setTranscribing(true);
          setJoinWarn(false);
          // Resume coaching once from the recovered context, not once for
          // every historical line. Ended calls never trigger live AI work.
          if (liveCaptureRef.current && recoveredCandidate) {
            sawCandidateRef.current = true;
            if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
            pauseTimerRef.current = setTimeout(fireTurnEnd, PAUSE_MS);
          }
        }
        return true;
      } catch {
        /* no backfill is fine */
        return false;
      }
    },
    [room, mapRole, fireTurnEnd]
  );

  const ensureStreamAccess = useCallback(async (): Promise<StreamAccess> => {
    const cached = streamAccessRef.current;
    if (cached && Date.parse(cached.expiresAt) > Date.now() + 60000) {
      return cached;
    }
    if (accessPromiseRef.current) return accessPromiseRef.current;

    const request = fetch("/api/meet/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: room }),
      })
      .then(async (response) => {
        const data = await response.json();
        if (roomRef.current !== room) {
          throw new Error("The call room changed while access was loading");
        }
        if (
          !response.ok ||
          typeof data.token !== "string" ||
          typeof data.workerWs !== "string" ||
          typeof data.expiresAt !== "string"
        ) {
          throw new Error(data.error || "Private transcript access failed");
        }
        const access: StreamAccess = {
          token: data.token,
          workerWs: data.workerWs,
          expiresAt: data.expiresAt,
          botName:
            typeof data.botName === "string"
              ? data.botName
              : "Your LiveCoach Notetaker",
          coachHints: Array.isArray(data.coachHints)
            ? data.coachHints.filter((hint: unknown) => typeof hint === "string")
            : [],
          teamHints: Array.isArray(data.teamHints)
            ? data.teamHints.filter((hint: unknown) => typeof hint === "string")
            : [],
        };
        streamAccessRef.current = access;
        coachHintsRef.current = access.coachHints;
        teamHintsRef.current = access.teamHints;
        setBotName(access.botName);
        return access;
      })
      .finally(() => {
        if (roomRef.current === room) accessPromiseRef.current = null;
      });
    accessPromiseRef.current = request;
    return request;
  }, [room]);

  useEffect(() => {
    roomRef.current = room;
    streamAccessRef.current = null;
    accessPromiseRef.current = null;
    coachHintsRef.current = [];
    teamHintsRef.current = [];
  }, [room]);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    const connectionAttempt = ++connectionAttemptRef.current;
    closedRef.current = false;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (wsRef.current) {
      try {
        // Replacing a socket is intentional. Do not let the old socket's
        // close handler schedule another connection for a stale call room.
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    setWsState("connecting");
    try {
      const access = await ensureStreamAccess();
      if (
        closedRef.current ||
        connectionAttempt !== connectionAttemptRef.current
      ) {
        return;
      }
      // Load the canonical transcript after account-specific speaker aliases
      // arrive, even when the display socket is temporarily unavailable.
      void deliverBackfill();
      const ws = new WebSocket(
        `${access.workerWs}?session=${encodeURIComponent(room)}`,
        ["livecoach-v1", `livecoach-token.${access.token}`]
      );
      wsRef.current = ws;
      const isCurrentSocket = () =>
        !closedRef.current &&
        wsRef.current === ws &&
        connectionAttempt === connectionAttemptRef.current;
      ws.onopen = () => {
        if (!isCurrentSocket()) return;
        setWsState("on");
        retryRef.current = 0;
        // We may have missed utterances while the socket was down - recover them.
        deliverBackfill();
      };
      ws.onerror = () => {
        if (!isCurrentSocket()) return;
        setWsState("error");
      };
      ws.onclose = (event) => {
        // An older socket can finish closing after its replacement is already
        // live. Never let that stale callback overwrite the healthy state.
        if (!isCurrentSocket()) return;
        wsRef.current = null;
        setWsState("off");
        if (event.code === 4401 || event.code === 4403) {
          streamAccessRef.current = null;
        }
        // Auto-reconnect with backoff unless we're intentionally tearing down.
        if (closedRef.current) return;
        const delay = Math.min(8000, 800 * Math.pow(2, retryRef.current));
        retryRef.current += 1;
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(() => {
          if (!closedRef.current) connect();
        }, delay);
      };
      ws.onmessage = (e: MessageEvent) => {
        if (!isCurrentSocket()) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "utterance") {
            // Receiving speech is definitive proof that this display socket is
            // healthy, even if the browser emitted a transient error first.
            setWsState("on");
            handleUtterance(msg.speaker || "", msg.role || "", msg.text || "", msg.ts);
          }
        } catch {
          /* ignore */
        }
      };
    } catch (error: any) {
      setWsState("error");
      setStatus(error?.message || "Private transcript access failed");
      if (
        !closedRef.current &&
        connectionAttempt === connectionAttemptRef.current
      ) {
        reconnectRef.current = setTimeout(() => connect(), 2000);
      }
    } finally {
      if (connectionAttempt === connectionAttemptRef.current) {
        connectingRef.current = false;
      }
    }
  }, [room, handleUtterance, deliverBackfill, ensureStreamAccess]);

  // open the socket as soon as we're in the call; clean up on unmount
  useEffect(() => {
    if (!streamReady) return;
    connect();
    return () => {
      closedRef.current = true;
      connectionAttemptRef.current += 1;
      connectingRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (joinWatchdogRef.current) clearTimeout(joinWatchdogRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [connect, streamReady]);

  const wsConnected = wsState === "on";
  useEffect(() => {
    if (!botId || wsConnected) {
      setShowReconnectWarning(false);
      return;
    }
    const warningTimer = setTimeout(
      () => setShowReconnectWarning(true),
      WS_RECONNECT_WARNING_GRACE_MS
    );
    return () => clearTimeout(warningTimer);
  }, [botId, wsConnected]);

  // Mid-call stall watch. The join watchdog only covers getting IN; this covers
  // capture dying AFTER it started - the socket stays "on" so the disconnect
  // banner won't fire, and a single early line had already latched on-air true.
  // If transcript has started and then nothing arrives for CAPTURE_STALE_MS,
  // flag it so the green light can't lie about a bot that stopped hearing.
  useEffect(() => {
    if (!botId) {
      setCaptureStalled(false);
      return;
    }
    const iv = setInterval(() => {
      if (!lastUtterAtRef.current) return; // nothing yet - the join watchdog owns that
      setCaptureStalled(Date.now() - lastUtterAtRef.current > CAPTURE_STALE_MS);
    }, 15000);
    return () => clearInterval(iv);
  }, [botId]);

  // Five-minute quiet-call safety. It starts only after a genuine transcript
  // has arrived, ignores a disconnected display socket, and checks wall-clock
  // time on focus as well as on an interval so background throttling cannot
  // stretch the timer indefinitely. Recall enforces the same limit itself as
  // the provider-side cost backstop.
  useEffect(() => {
    if (!botId || !transcribing) {
      setSilenceRemainingMs(null);
      return;
    }

    const check = async () => {
      if (!lastUtterAtRef.current || silenceEndRequestedRef.current) return;
      // A broken display is not proof of silence. Wait for recovery and its
      // canonical backfill before making an automatic end decision.
      if (wsState !== "on") return;
      const remaining = callSilenceRemainingMs(lastUtterAtRef.current);
      setSilenceRemainingMs(remaining);
      if (remaining === 0) {
        if (silenceCheckInFlightRef.current) return;
        silenceCheckInFlightRef.current = true;
        const observedLastSpeech = lastUtterAtRef.current;
        const backfillVerified = await deliverBackfill();
        silenceCheckInFlightRef.current = false;
        // Never end on a stale display. A newly recovered utterance restarts
        // the clock, while an unavailable canonical backfill simply retries on
        // the next check and leaves Recall's provider timer to stop the cost.
        if (
          !backfillVerified ||
          lastUtterAtRef.current > observedLastSpeech ||
          silenceEndRequestedRef.current
        ) {
          return;
        }
        silenceEndRequestedRef.current = true;
        setStatus("five minutes of silence detected - ending safely...");
        onSilenceTimeoutRef.current();
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), 15_000);
    const onWake = () => void check();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [botId, transcribing, wsState, deliverBackfill]);

  const sendBot = useCallback(async () => {
    // Guard against a double-tap firing two bots: `disabled` only updates on the
    // next render, so a fast second click can slip through before React catches
    // up. The ref blocks it synchronously, and we never send if a bot is live.
    if (recovering || !meetingUrl.trim() || botIdRef.current || sendingRef.current) return;
    sendingRef.current = true;
    setStatus("sending bot...");
    try {
      const r = await fetch("/api/meet/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingUrl: meetingUrl.trim(),
          sessionId: room,
          upcomingId,
        }),
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
      if (typeof d.botName === "string" && d.botName.trim()) {
        setBotName(d.botName.trim());
      }
      botIdRef.current = d.botId;
      setTranscribing(false);
      setJoinWarn(false);
      setProviderState(null);
      setStatus(
        d.status === "scheduled"
          ? `notetaker scheduled for ${new Date(d.scheduledJoinAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, five minutes before the meeting`
          : d.sharedCapture
          ? d.status === "shared_active"
            ? "shared notetaker connected, loading this call"
            : "notetaker requested for both private coaching sessions"
          : "bot requested, waiting for it to join"
      );
      if (wsState !== "on") connect();
      if (d.sharedCapture) void deliverBackfill();
      // Transcript is the strongest proof that capture is healthy. The provider
      // status poll below identifies whether a silent bot is still launching,
      // waiting, in the call, or has failed. This timer is only a fallback when
      // the provider cannot return a useful state.
      if (joinWatchdogRef.current) clearTimeout(joinWatchdogRef.current);
      joinWatchdogRef.current = setTimeout(() => {
        joinWatchdogRef.current = null;
        setJoinWarn(true);
      }, 90000);
    } catch (e: any) {
      setStatus("error: " + e.message);
    } finally {
      sendingRef.current = false;
    }
  }, [recovering, meetingUrl, room, upcomingId, wsState, connect, deliverBackfill]);

  // Recall accepts a create request before the meeting platform has accepted
  // the bot. Poll the exact provider lifecycle while joining so LiveCoach never
  // guesses that a missing bot is in a waiting room. Run on mount too so an
  // automatic notetaker is attached before opening the live stream. POST only
  // resumes an existing subscription and can never create a provider bot.
  useEffect(() => {
    if (botId && transcribing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      let terminal = false;
      try {
        const params = new URLSearchParams({ session: room });
        if (upcomingId) params.set("upcoming", upcomingId);
        const response = await fetch(`/api/meet/status?${params.toString()}`, {
          method: "POST",
          cache: "no-store",
        });
        const data = await response.json();
        if (cancelled) return;
        if (response.status === 404) {
          setRecovering(false);
          setStreamReady(true);
          setStatus("not connected");
          return;
        }
        if (!response.ok) {
          setStatus(data.error || "Unable to reconnect to the existing notetaker. Retrying...");
          // Access/conflict errors need a visible resolution, not a new bot.
          if ([400, 401, 403, 409].includes(response.status)) return;
        }
        if (!cancelled && response.ok && data?.state) {
          if (data.sessionId !== room) {
            // An older manual call can have a different saved private room.
            // Let the parent remount against that exact room before streaming.
            onRecoveredRef.current(data.sessionId, false);
            return;
          }
          const next = data.state as ProviderBotState;
          botIdRef.current = data.botId;
          setBotId(data.botId);
          if (data.botName) setBotName(data.botName);
          liveCaptureRef.current = data.canResume === true;
          setRecovering(false);
          setStreamReady(true);
          if (data.canResume) onRecoveredRef.current(room, true);
          setProviderState(next);
          setStatus(next.message);
          terminal = next.terminal;
          if (
            next.phase === "waiting_room" ||
            next.phase === "in_call_not_recording" ||
            next.phase === "recording"
          ) {
            setJoinWarn(false);
          }
          if (terminal) {
            setJoinWarn(true);
            if (joinWatchdogRef.current) {
              clearTimeout(joinWatchdogRef.current);
              joinWatchdogRef.current = null;
            }
          }
        }
      } catch {
        // A transient status read must not interrupt the transcript connection.
        // The fallback watchdog still warns if no verified state ever arrives.
      }
      if (!cancelled && !terminal) {
        timer = setTimeout(poll, 10000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [botId, room, upcomingId, transcribing]);

  const handledStartRequestRef = useRef(0);
  useEffect(() => {
    if (recovering) return;
    if (!startRequest || startRequest === handledStartRequestRef.current) return;
    handledStartRequestRef.current = startRequest;
    sendBot();
  }, [recovering, startRequest, sendBot]);

  // Retry: stop the (non-joined) bot and send a fresh one. Forces the synchronous
  // botId mirror clear so the re-send isn't blocked by the in-flight guard.
  async function retryBot() {
    await stopBot();
    botIdRef.current = "";
    setBotId("");
    setJoinWarn(false);
    setTranscribing(false);
    setProviderState(null);
    setCaptureStalled(false);
    lastUtterAtRef.current = 0; // restart the stall clock for the fresh bot
    silenceEndRequestedRef.current = false;
    setSilenceRemainingMs(null);
    setTimeout(() => sendBot(), 400);
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
      if (joinWatchdogRef.current) {
        clearTimeout(joinWatchdogRef.current);
        joinWatchdogRef.current = null;
      }
      setStatus(r.ok ? "bot removed" : "stop error: " + (d.error || r.status));
      if (r.ok) {
        setBotId("");
        botIdRef.current = "";
        setTranscribing(false);
        setJoinWarn(false);
        setProviderState(null);
        setSilenceRemainingMs(null);
      }
    } catch (e: any) {
      setStatus("error: " + e.message);
    }
  }

  // Honest on-air state. Transcript remains the proof that capture is healthy,
  // while Recall's lifecycle distinguishes launching, waiting, joined, ended,
  // and failed. A missing transcript alone is never labelled as a waiting room.
  const providerPhase = providerState?.phase;
  const air:
    | "off"
    | "scheduled"
    | "joining"
    | "waiting"
    | "joined"
    | "on"
    | "stalled"
    | "failed"
    | "ended"
    | "stale" = !botId
    ? "off"
    : providerPhase === "failed"
    ? "failed"
    : providerPhase === "ended"
    ? "ended"
    : transcribing && captureStalled
    ? "stale"
    : transcribing
    ? "on"
    : providerPhase === "scheduled"
    ? "scheduled"
    : providerPhase === "waiting_room"
    ? "waiting"
    : providerPhase === "in_call_not_recording" ||
      providerPhase === "recording"
    ? "joined"
    : joinWarn
    ? "stalled"
    : "joining";
  const airPill =
    recovering
      ? { cls: "border-amber/60 bg-amber/15 text-amber", dot: "bg-amber animate-pulse", label: "Connecting…" }
      : air === "on"
      ? { cls: "border-sage/60 bg-sage/15 text-sage", dot: "bg-sage animate-pulse", label: "On air" }
      : air === "joined"
      ? { cls: "border-sage/60 bg-sage/15 text-sage", dot: "bg-sage animate-pulse", label: "In call" }
      : air === "waiting"
      ? { cls: "border-amber/60 bg-amber/15 text-amber", dot: "bg-amber animate-pulse", label: "Waiting room" }
      : air === "joining"
      ? { cls: "border-amber/60 bg-amber/15 text-amber", dot: "bg-amber animate-pulse", label: "Joining…" }
      : air === "scheduled"
      ? { cls: "border-sage/60 bg-sage/15 text-sage", dot: "bg-sage", label: "Scheduled" }
      : air === "stale"
      ? { cls: "border-rust/60 bg-rust/15 text-rust", dot: "bg-rust animate-pulse", label: "Check notetaker" }
      : air === "failed"
      ? { cls: "border-rust/60 bg-rust/15 text-rust", dot: "bg-rust", label: "Join failed" }
      : air === "ended"
      ? { cls: "border-edge bg-panel text-muted", dot: "bg-muted", label: "Ended" }
      : air === "stalled"
      ? { cls: "border-rust/60 bg-rust/15 text-rust", dot: "bg-rust", label: "Not verified" }
      : { cls: "border-rust/55 bg-rust/15 text-rust", dot: "bg-rust", label: "Off air" };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 rounded-2xl border border-edge bg-panel/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
            Meet / Teams / Zoom
          </p>
          <p className="mt-1 font-mono text-[0.56rem] text-muted">{botName}</p>
        </div>
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.58rem] uppercase tracking-[0.15em] ${airPill.cls}`}
        >
          <span className={`h-2 w-2 rounded-full ${airPill.dot}`} />
          {airPill.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          placeholder="Paste Meet / Teams / Zoom link"
          className="min-w-0 w-full flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-sm text-bone"
        />
        <button
          onClick={sendBot}
          disabled={recovering || !meetingUrl.trim() || !!botId || status === "sending bot..."}
          title={
            botId
              ? "A notetaker request is active. Stop it before sending another."
              : "Send the bot to join and transcribe"
          }
          className={`rounded-full border px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
            air === "on" || air === "joined"
              ? "cursor-default border-sage bg-sage text-ink"
              : air === "failed" || air === "stalled"
              ? "cursor-default border-rust bg-rust/15 text-rust"
              : air === "ended"
              ? "cursor-default border-edge bg-panel text-muted"
              : botId
              ? "cursor-default border-amber bg-amber/15 text-amber"
              : "border-amber/60 bg-amber/15 text-amber hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40"
          }`}
        >
          {recovering
            ? "connecting…"
            : botId
            ? air === "on"
              ? "● on air"
              : air === "joined"
              ? "in call"
              : air === "waiting"
              ? "waiting room"
              : air === "failed"
              ? "join failed"
              : air === "ended"
              ? "ended"
              : air === "scheduled"
              ? "scheduled"
              : air === "stalled"
              ? "not verified"
              : "● joining…"
            : status === "sending bot..."
            ? "sending…"
            : "Send bot"}
        </button>
        <button
          onClick={stopBot}
          disabled={!botId}
          title={botId ? "Take the bot off air (stop transcribing)" : "No bot is live"}
          // Neutral while live (red is reserved for the off-air state), with a
          // red affordance on hover so it still reads as the stop action.
          className={`rounded-full border px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
            botId
              ? "border-edge text-bone hover:border-rust/60 hover:text-rust hover:bg-rust/10"
              : "border-edge text-muted disabled:cursor-not-allowed disabled:opacity-40"
          }`}
        >
          Stop bot
        </button>
      </div>

      <p className="font-mono text-[0.6rem] text-muted">{status}</p>
      {botId && (
        <p className="font-mono text-[0.58rem] leading-relaxed text-sage">
          Auto stop protected: leaves 30 seconds after everyone leaves, detects
          other notetakers, and ends after five continuous quiet minutes.
        </p>
      )}

      {botId &&
        silenceRemainingMs !== null &&
        silenceRemainingMs > 0 &&
        silenceRemainingMs <= CALL_SILENCE_WARNING_MS && (
          <div className="rounded-lg border border-amber/60 bg-amber/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-amber">
            No speech detected for four minutes. LiveCoach will end and build
            the summary in {Math.max(1, Math.ceil(silenceRemainingMs / 1000))}
            seconds. Speak to keep it open.
          </div>
        )}

      {/* The browser display socket is separate from Recall's recording and the
          worker's persistence path. Only warn after a sustained interruption,
          and never claim that a display reconnect means capture has stopped. */}
      {botId && showReconnectWarning && air !== "failed" && air !== "ended" && (
        <div className="rounded-lg border border-amber/60 bg-amber/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-amber">
          {"⚠"} Live transcript display reconnecting. This does not mean the
          notetaker has stopped recording. Saved speech will backfill
          automatically when the display reconnects.
        </div>
      )}

      {air === "waiting" && (
        <div className="rounded-lg border border-amber/60 bg-amber/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-amber">
          {"⚠"} The provider confirms that the notetaker is in the waiting room.
          <span className="mt-1 block text-bone">
            Admit the notetaker from the Meet prompt or participants list. Capture
            starts after it enters the meeting.
          </span>
        </div>
      )}

      {air === "failed" && providerState && (
        <div className="rounded-lg border border-rust/60 bg-rust/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-rust">
          {"⚠"} {providerState.message}
          {providerState.subCode && (
            <span className="mt-1 block text-bone">
              Blocker code {providerState.subCode}
            </span>
          )}
          <button
            onClick={retryBot}
            className="mt-2 rounded-full border border-rust/60 px-2.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
          >
            retry bot
          </button>
        </div>
      )}

      {air === "ended" && providerState && (
        <div className="rounded-lg border border-edge bg-panel/70 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-muted">
          {providerState.message}
          <button
            onClick={retryBot}
            className="ml-2 rounded-full border border-edge px-2.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber"
          >
            retry bot
          </button>
        </div>
      )}

      {air === "joined" && joinWarn && (
        <div className="rounded-lg border border-rust/60 bg-rust/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-rust">
          {"⚠"} The provider says the notetaker joined, but no speech has reached
          LiveCoach yet.
          <span className="mt-1 block text-bone">
            Check that recording is allowed and ask someone to speak. Retry if it
            remains silent.
          </span>
          <button
            onClick={retryBot}
            className="mt-1 rounded-full border border-rust/60 px-2.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
          >
            retry bot
          </button>
        </div>
      )}

      {/* The fallback watchdog fired without a verified provider state. Do not
          claim the bot is in a waiting room when Recall has not said that. */}
      {air === "stalled" && (
        <div className="rounded-lg border border-rust/60 bg-rust/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-rust">
          {"⚠"} Nothing is being transcribed and the provider has not confirmed
          that the notetaker reached the meeting.
          <span className="mt-1 block text-bone">
            It is not necessarily in the waiting room. Retry once, or continue
            with Recap by voice if the new bot does not appear.
          </span>
          <button
            onClick={retryBot}
            className="mt-1 rounded-full border border-rust/60 px-2.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
          >
            retry bot
          </button>
        </div>
      )}

      {/* Capture started, then went silent for too long while the bot is still
          live and the socket is up. The bot has most likely been dropped or
          removed from the call - the silent stop that once showed a green light. */}
      {air === "stale" && (
        <div className="rounded-lg border border-rust/60 bg-rust/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-rust">
          {"⚠"} No transcript for over 90s. If people are talking, the notetaker
          has dropped or been removed from the call.
          <span className="mt-1 block text-bone">
            Check it's still in the participants. If it's gone, Retry to send a
            fresh one and admit it. You can keep talking - it backfills what it
            missed once it's back.
          </span>
          <button
            onClick={retryBot}
            className="mt-1 rounded-full border border-rust/60 px-2.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
          >
            retry bot
          </button>
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
