"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { floatToPcm16, playOfferChime, resampleLinear } from "@/components/interviewer/audio";
import { startLeadListener } from "@/components/interviewer/lead-listener";
import { isDeepgramConcurrencyRefusal } from "@/lib/interviewer/concurrency";

export type Caption = { id: string; speaker: "agent" | "lead"; text: string };

type QueuePayload = {
  state?: string;
  sessionId?: string | null;
  position?: number;
  priority?: boolean;
  offerExpiresAt?: string | null;
  waitLabel?: string;
  overTenMinutes?: boolean;
  error?: string;
};

type ReadyPayload = QueuePayload & {
  agentToken?: string | null;
  listenToken?: string | null;
  settings?: Record<string, unknown> | null;
  voiceAgentUrl?: string;
  maxMinutes?: number | null;
};

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data: data as T };
}

export function useInterviewerCall(token: string) {
  const [phase, setPhase] = useState<"mic" | "waiting" | "live" | "ended">("mic");
  const [connecting, setConnecting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [waitLabel, setWaitLabel] = useState("Waiting for a seat");
  const [overTenMinutes, setOverTenMinutes] = useState(false);
  const [calmMessage, setCalmMessage] = useState("");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [billableSeconds, setBillableSeconds] = useState<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  const teardownRef = useRef<((mode: "end" | "drop") => void) | null>(null);
  const connectingRef = useRef(false);
  const holdPollRef = useRef(false);
  const offeredRef = useRef<string | null>(null);
  const lineRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const rememberQueue = useCallback((data: QueuePayload) => {
    if (data.sessionId) {
      sessionRef.current = data.sessionId;
      setSessionId(data.sessionId);
    }
    setPosition(Number(data.position || 0));
    setWaitLabel(data.waitLabel || "Waiting for a seat");
    setOverTenMinutes(data.overTenMinutes === true);
  }, []);

  const publishLine = useCallback((speaker: "agent" | "lead", text: string) => {
    const clean = text.trim();
    const session = sessionRef.current;
    if (!clean || !session) return;
    lineRef.current += 1;
    const clientKey = `${speaker}-${lineRef.current}-${clean.slice(0, 18)}`.replace(/\s+/g, "-").slice(0, 80);
    setCaptions((current) => [...current.slice(-12), { id: clientKey, speaker, text: clean }]);
    void postJson("/api/interviewer/utterances", {
      token,
      sessionId: session,
      utterances: [{ speaker, text: clean, ts: new Date().toISOString(), clientKey }],
    });
  }, [token]);

  const connectVoice = useCallback(async () => {
    const session = sessionRef.current;
    const stream = streamRef.current;
    if (!session || !stream || connectingRef.current || phaseRef.current === "live") return;
    connectingRef.current = true;
    setConnecting(true);
    setCalmMessage("");
    try {
      const ready = await postJson<ReadyPayload>("/api/interviewer/token", {
        token,
        sessionId: session,
        purpose: "both",
      });
      const sentToQueue = ready.data.state === "queued" || ready.data.state === "offered";
      if (ready.data.priority || sentToQueue) {
        rememberQueue(ready.data);
        setConnecting(false);
        setPhase("waiting");
        return;
      }
      if (!ready.ok || ready.data.state !== "ready" || !ready.data.agentToken || !ready.data.listenToken || !ready.data.settings) {
        await postJson("/api/interviewer/slots/release", { token, sessionId: session, reason: "retry" });
        setCalmMessage("We could not open the voice connection. You are still in the queue.");
        setConnecting(false);
        setPhase("waiting");
        return;
      }

      const context = new AudioContext();
      await context.resume();
      const mix = context.createMediaStreamDestination();
      const mic = context.createMediaStreamSource(stream);
      mic.connect(mix);
      const agentGain = context.createGain();
      agentGain.connect(context.destination);
      agentGain.connect(mix);
      const playback: AudioBufferSourceNode[] = [];
      let nextAt = 0;
      const bargeIn = () => {
        playback.splice(0).forEach((node) => {
          try { node.stop(); } catch { /* already finished */ }
        });
        nextAt = 0;
      };
      const playAgent = (pcm: ArrayBuffer) => {
        const samples = new Int16Array(pcm);
        const floats = new Float32Array(samples.length);
        for (let index = 0; index < samples.length; index += 1) floats[index] = samples[index] / 32768;
        const shaped = resampleLinear(floats, 24000, context.sampleRate);
        const buffer = context.createBuffer(1, shaped.length, context.sampleRate);
        buffer.getChannelData(0).set(shaped);
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.connect(agentGain);
        const start = Math.max(context.currentTime + 0.02, nextAt);
        node.start(start);
        nextAt = start + buffer.duration;
        playback.push(node);
      };

      let applied = false;
      let stopped = false;
      let settling = false;
      let endAfterAudio = false;
      const agentSocket = new WebSocket(
        ready.data.voiceAgentUrl || "wss://agent.deepgram.com/v1/agent/converse",
        ["bearer", ready.data.agentToken]
      );
      agentSocket.binaryType = "arraybuffer";
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      processor.connect(silent);
      silent.connect(context.destination);
      mic.connect(processor);
      processor.onaudioprocess = (event) => {
        if (!applied || agentSocket.readyState !== WebSocket.OPEN) return;
        const channel = event.inputBuffer.getChannelData(0);
        agentSocket.send(floatToPcm16(resampleLinear(channel, context.sampleRate, 16000)));
      };

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(mix.stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start(1000);

      const stopSockets = () => {
        stopped = true;
        applied = false;
        processor.onaudioprocess = null;
        try { processor.disconnect(); } catch { /* ignore */ }
        if (agentSocket.readyState === WebSocket.OPEN || agentSocket.readyState === WebSocket.CONNECTING) agentSocket.close();
      };

      let stopLead: () => void = () => undefined;
      let heartbeat: number | ReturnType<typeof setInterval> | null = null;
      let capTimer: number | ReturnType<typeof setTimeout> | null = null;
      const returnToQueue = async (priority: boolean, message: string) => {
        if (settling) return;
        settling = true;
        holdPollRef.current = false;
        stopSockets();
        stopLead();
        if (heartbeat) window.clearInterval(heartbeat);
        if (capTimer) window.clearTimeout(capTimer);
        if (recorder.state !== "inactive") recorder.stop();
        await context.close().catch(() => undefined);
        teardownRef.current = null;
        if (priority) {
          const moved = await postJson<QueuePayload>("/api/interviewer/queue/priority", { token, sessionId: session });
          if (moved.data.state === "in_call") {
            const ended = await postJson<{ billableSeconds?: number }>("/api/interviewer/sessions/end", { token, sessionId: session });
            setBillableSeconds(Number(ended.data.billableSeconds || 0));
            setConnecting(false);
            setPhase("ended");
            return;
          }
          rememberQueue(moved.data);
          setCalmMessage("");
        } else {
          await postJson("/api/interviewer/slots/release", { token, sessionId: session, reason: "retry" });
          setCalmMessage(message);
        }
        setConnecting(false);
        setPhase("waiting");
      };

      const finish = async () => {
        if (settling) return;
        settling = true;
        holdPollRef.current = false;
        stopSockets();
        stopLead();
        if (heartbeat) window.clearInterval(heartbeat);
        if (capTimer) window.clearTimeout(capTimer);
        const blob = await new Promise<Blob>((resolve) => {
          recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          if (recorder.state !== "inactive") recorder.stop();
          else resolve(new Blob(chunks, { type: "audio/webm" }));
        });
        await context.close().catch(() => undefined);
        const ended = await postJson<{ billableSeconds?: number }>("/api/interviewer/sessions/end", { token, sessionId: session });
        if (blob.size > 0) {
          const upload = await postJson<{ signedUrl?: string; path?: string }>("/api/interviewer/recording", {
            token,
            sessionId: session,
            fileSize: blob.size,
          });
          if (upload.ok && upload.data.signedUrl && upload.data.path) {
            const put = await fetch(upload.data.signedUrl, {
              method: "PUT",
              headers: { "Content-Type": blob.type || "audio/webm", "x-upsert": "true" },
              body: blob,
            });
            if (put.ok) {
              await postJson("/api/interviewer/recording/complete", { token, sessionId: session, path: upload.data.path });
            }
          }
        }
        teardownRef.current = null;
        setBillableSeconds(Number(ended.data.billableSeconds || 0));
        setConnecting(false);
        setPhase("ended");
      };

      const handleFunctions = async (functions: Array<{ id?: string; name?: string; arguments?: unknown }>) => {
        for (const fn of functions) {
          let args: Record<string, unknown> = {};
          try {
            args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments || "{}") : (fn.arguments as Record<string, unknown>) || {};
          } catch {
            args = {};
          }
          let content: unknown = { ok: false };
          try {
            if (fn.name === "suggest_meeting_times") {
              content = (await postJson("/api/interviewer/book", { token, sessionId: session, action: "suggest", ...args })).data;
            } else if (fn.name === "book_meeting") {
              content = (await postJson("/api/interviewer/book", {
                token,
                sessionId: session,
                action: "book",
                start: args.start,
                end: args.end,
              })).data;
            } else if (fn.name === "capture_timing" || fn.name === "record_disposition") {
              content = (await postJson("/api/interviewer/outcome", { token, sessionId: session, ...args })).data;
            } else if (fn.name === "end_call") {
              endAfterAudio = true;
              content = { ok: true };
            }
          } catch {
            content = { ok: false, note: "That action could not be completed." };
          }
          if (agentSocket.readyState === WebSocket.OPEN) {
            agentSocket.send(JSON.stringify({
              type: "FunctionCallResponse",
              id: fn.id,
              name: fn.name,
              content: JSON.stringify(content),
            }));
          }
        }
      };

      agentSocket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          if (event.data instanceof ArrayBuffer) playAgent(event.data);
          return;
        }
        let message: { type?: string; role?: string; content?: string; description?: string; code?: string | number; functions?: Array<{ id?: string; name?: string; arguments?: unknown }> };
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === "Welcome") agentSocket.send(JSON.stringify(ready.data.settings));
        else if (message.type === "SettingsApplied") {
          applied = true;
          setConnecting(false);
          setPhase("live");
        } else if (message.type === "UserStartedSpeaking") bargeIn();
        else if (message.type === "ConversationText" && message.role === "assistant" && message.content) publishLine("agent", message.content);
        else if (message.type === "Error") {
          const detail = { message: message.description || "", code: message.code };
          if (isDeepgramConcurrencyRefusal(detail)) void returnToQueue(true, "");
          else if (!applied) void returnToQueue(false, "We could not open the voice connection. You are still in the queue.");
        } else if (message.type === "FunctionCallRequest") void handleFunctions(message.functions || []);
        else if (message.type === "AgentAudioDone" && endAfterAudio) void finish();
      };
      agentSocket.onclose = (event) => {
        if (stopped || applied) return;
        const detail = { closeCode: event.code, message: event.reason };
        void returnToQueue(isDeepgramConcurrencyRefusal(detail), "We could not open the voice connection. You are still in the queue.");
      };

      holdPollRef.current = true;
      stopLead = startLeadListener({
        stream,
        token: ready.data.listenToken,
        onTranscript: (text) => publishLine("lead", text),
        onRefusal: (detail) => {
          if (isDeepgramConcurrencyRefusal(detail)) void returnToQueue(true, "");
        },
      });

      heartbeat = window.setInterval(() => {
        void postJson<{ state?: string }>("/api/interviewer/slots/heartbeat", { token, sessionId: session }).then(({ data }) => {
          if (data.state === "lost" && phaseRef.current === "live") void finish();
        });
      }, 15000);
      capTimer = ready.data.maxMinutes
        ? window.setTimeout(() => { void finish(); }, ready.data.maxMinutes * 60 * 1000)
        : null;

      teardownRef.current = (mode) => {
        if (mode === "end") void finish();
        else void returnToQueue(false, "");
      };
    } finally {
      connectingRef.current = false;
    }
  }, [publishLine, rememberQueue, token]);

  const join = useCallback(async (stream: MediaStream) => {
    streamRef.current = stream;
    setCalmMessage("");
    const { data } = await postJson<QueuePayload>("/api/interviewer/slots/claim", {
      token,
      sessionId: sessionRef.current,
    });
    if (data.error) {
      setCalmMessage("This link is not available.");
      return;
    }
    rememberQueue(data);
    if (data.state === "claimed") {
      await connectVoice();
      return;
    }
    setPhase("waiting");
  }, [connectVoice, rememberQueue, token]);

  useEffect(() => {
    if (phase !== "waiting") return undefined;
    let stopped = false;
    const look = async () => {
      const session = sessionRef.current;
      if (!session || stopped || connectingRef.current || holdPollRef.current || phaseRef.current === "live") return;
      const { data } = await postJson<QueuePayload>("/api/interviewer/queue/status", { token, sessionId: session });
      if (stopped || data.error) return;
      rememberQueue(data);
      const offerKey = data.state === "claimed" ? "claimed" : data.offerExpiresAt || "";
      if ((data.state === "offered" || data.state === "claimed") && offeredRef.current !== offerKey) {
        offeredRef.current = offerKey;
        if (data.state === "offered") playOfferChime();
        const claim = await postJson<QueuePayload>("/api/interviewer/slots/claim", { token, sessionId: session });
        rememberQueue(claim.data);
        if (claim.data.state === "claimed") await connectVoice();
      }
    };
    void look();
    const timer = window.setInterval(() => { void look(); }, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [connectVoice, phase, rememberQueue, token]);

  const hangUp = useCallback(() => {
    teardownRef.current?.("end");
  }, []);

  const leaveQueue = useCallback(async () => {
    const session = sessionRef.current;
    if (session) await postJson("/api/interviewer/queue/leave", { token, sessionId: session });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setBillableSeconds(0);
    setPhase("ended");
  }, [token]);

  return {
    phase,
    connecting,
    sessionId,
    position,
    waitLabel,
    overTenMinutes,
    calmMessage,
    captions,
    billableSeconds,
    join,
    hangUp,
    leaveQueue,
  };
}
