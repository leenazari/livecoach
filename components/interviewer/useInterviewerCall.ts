"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { floatToPcm16, playOfferChime, resampleLinear } from "@/components/interviewer/audio";
import { startLeadListener } from "@/components/interviewer/lead-listener";
import { isDeepgramConcurrencyRefusal } from "@/lib/interviewer/concurrency";
import { leadDeclinedDemo } from "@/lib/interviewer/call-close";
import { TIME_LIMIT_GOODBYE, formatCountdown, twoMinuteLine } from "@/lib/interviewer/call-limit";
import { isHoldRequest, nextSilenceCue, type SilencePhase } from "@/lib/interviewer/silence";
import {
  agentTurnExtends,
  looksLikeSpeakerEcho,
  utteranceKey,
  type LockedUtterance,
} from "@/lib/interviewer/listen-transcript";
import { stripAgentContext, toSpokenPlain, toolReplyForAgent } from "@/lib/interviewer/spoken-text";
import { matchSpokenSlide } from "@/lib/interviewer/slide-match";

export type Caption = { id: string; speaker: "agent" | "lead"; text: string };

export type TranscriptDebug = {
  interim: string;
  echoes: string[];
};

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
  callEndsAt?: string | null;
  deckId?: string | null;
  openingSlide?: { number?: number; title?: string; slogan?: string; url?: string | null } | null;
  slideIndex?: Array<{ number: number; title: string; slogan?: string; url?: string | null; points?: string[]; keywords?: string[] }>;
};

type SlideChoice = { number: number; title: string; slogan?: string; url?: string | null; points?: string[]; keywords?: string[] };
export type LeadRecap = { summary: string; topics: string[]; nextStep: string };

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
  const [interim, setInterim] = useState("");
  const [echoes, setEchoes] = useState<string[]>([]);
  const [slideUrl, setSlideUrl] = useState("");
  const [slideLabel, setSlideLabel] = useState("");
  const [slideSlogan, setSlideSlogan] = useState("");
  const [slideNumber, setSlideNumber] = useState(0);
  const [slideIndex, setSlideIndex] = useState<SlideChoice[]>([]);
  const [billableSeconds, setBillableSeconds] = useState<number | null>(null);
  const [muted, setMutedState] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [endAsk, setEndAsk] = useState(false);
  const [recap, setRecap] = useState<LeadRecap | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  const teardownRef = useRef<((mode: "end" | "drop") => void) | null>(null);
  const connectingRef = useRef(false);
  const holdPollRef = useRef(false);
  const offeredRef = useRef<string | null>(null);
  const agentTurnRef = useRef<Caption | null>(null);
  const recentAgentRef = useRef<string[]>([]);
  const mutedRef = useRef(false);
  const deckRef = useRef<string | null>(null);
  const slideIndexRef = useRef<SlideChoice[]>([]);
  const agentSocketRef = useRef<WebSocket | null>(null);
  const bookedRef = useRef(false);
  const leadLinesRef = useRef<string[]>([]);
  const manualSlideUntil = useRef(0);
  const slideTimer = useRef<number | null>(null);
  const slideNumberRef = useRef(0);
  const endingSoon = useRef(false);
  const silenceRef = useRef({
    lastActivityAt: Date.now(),
    lastSpeaker: "agent" as "agent" | "lead",
    phase: "clear" as SilencePhase,
    holdSince: null as number | null,
    mutedSince: null as number | null,
    muteChecked: false,
    speaking: false,
    noiseAt: 0,
  });

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

  const saveCaption = useCallback((caption: Caption) => {
    const session = sessionRef.current;
    if (!session) return;
    setCaptions((current) => {
      const index = current.findIndex((line) => line.id === caption.id);
      if (index >= 0) {
        const next = current.slice();
        next[index] = caption;
        return next;
      }
      return [...current.slice(-40), caption];
    });
    void postJson("/api/interviewer/utterances", {
      token,
      sessionId: session,
      utterances: [{
        speaker: caption.speaker,
        text: caption.text,
        ts: new Date().toISOString(),
        utteranceId: caption.id,
      }],
    });
  }, [token]);

  const acceptLead = useCallback((utterance: LockedUtterance) => {
    const text = utterance.text.trim();
    if (!text) return;
    if (looksLikeSpeakerEcho(text, recentAgentRef.current)) {
      setEchoes((current) => [...current.slice(-8), text]);
      return;
    }
    leadLinesRef.current = [...leadLinesRef.current.slice(-30), text];
    saveCaption({ id: utterance.id, speaker: "lead", text });
  }, [saveCaption]);

  const acceptAgent = useCallback((text: string) => {
    const clean = toSpokenPlain(text);
    if (!clean) return;
    const previous = agentTurnRef.current;
    const caption = previous && agentTurnExtends(previous.text, clean)
      ? { id: previous.id, speaker: "agent" as const, text: clean }
      : {
          id: utteranceKey("agent", Date.now() / 1000, clean),
          speaker: "agent" as const,
          text: clean,
        };
    agentTurnRef.current = caption;
    recentAgentRef.current = [...recentAgentRef.current.slice(-3), clean];
    saveCaption(caption);
    if (Date.now() < manualSlideUntil.current) return;
    if (slideTimer.current) window.clearTimeout(slideTimer.current);
    slideTimer.current = window.setTimeout(() => {
      const next = matchSpokenSlide(clean, slideIndexRef.current.map((item) => ({ number: item.number, keywords: item.keywords || [] })), slideNumberRef.current);
      const slide = slideIndexRef.current.find((item) => item.number === next);
      if (!slide || Date.now() < manualSlideUntil.current) return;
      slideNumberRef.current = slide.number;
      setSlideNumber(slide.number);
      setSlideUrl(slide.url || "");
      setSlideLabel(slide.title);
      setSlideSlogan(slide.slogan || "");
      const session = sessionRef.current;
      if (session) {
        void postJson("/api/interviewer/slides", {
          token,
          sessionId: session,
          deckId: deckRef.current,
          slideNumber: slide.number,
          reason: `Auto: agent mentioned ${slide.title}`.slice(0, 240),
        });
      }
    }, 2000);
  }, [saveCaption, token]);

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
      deckRef.current = ready.data.deckId || null;
      const index = ready.data.slideIndex || [];
      slideIndexRef.current = index;
      setSlideIndex(index);
      if (ready.data.openingSlide) {
        setSlideUrl(ready.data.openingSlide.url || "");
        setSlideLabel(ready.data.openingSlide.title || "");
        setSlideSlogan(ready.data.openingSlide.slogan || "");
        const openingNumber = Number(ready.data.openingSlide.number || 1);
        slideNumberRef.current = openingNumber;
        setSlideNumber(openingNumber);
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
      agentSocketRef.current = agentSocket;
      silenceRef.current = {
        lastActivityAt: Date.now(),
        lastSpeaker: "agent",
        phase: "clear",
        holdSince: null,
        mutedSince: mutedRef.current ? Date.now() : null,
        muteChecked: false,
        speaking: false,
        noiseAt: 0,
      };
      let loudSince = 0;
      const say = (line: string, behavior: "default" | "queue" = "default") => {
        if (agentSocket.readyState !== WebSocket.OPEN) return;
        const message = stripAgentContext(line);
        agentSocket.send(JSON.stringify({ type: "InjectAgentMessage", behavior, message }));
      };
      const suggestNoise = () => {
        const now = Date.now();
        if (now - silenceRef.current.noiseAt < 180000) return;
        silenceRef.current.noiseAt = now;
        say("If you're chatting with someone there, feel free to mute your mic and unmute when you're ready, so I don't get confused.", "queue");
      };
      processor.onaudioprocess = (event) => {
        if (!applied || agentSocket.readyState !== WebSocket.OPEN || mutedRef.current) return;
        const channel = event.inputBuffer.getChannelData(0);
        let energy = 0;
        for (const sample of channel) energy += sample * sample;
        const rms = Math.sqrt(energy / Math.max(1, channel.length));
        if (rms > 0.05 && !silenceRef.current.speaking) {
          if (!loudSince) loudSince = Date.now();
          else if (Date.now() - loudSince > 4000) {
            suggestNoise();
            loudSince = Date.now();
          }
        } else loudSince = 0;
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
      let silenceTimer: number | ReturnType<typeof setInterval> | null = null;
      let capTimer: number | ReturnType<typeof setTimeout> | null = null;
      const stopSilence = () => {
        if (silenceTimer) window.clearInterval(silenceTimer);
        silenceTimer = null;
      };
      const returnToQueue = async (priority: boolean, message: string) => {
        if (settling) return;
        settling = true;
        holdPollRef.current = false;
        stopSockets();
        stopLead();
        if (heartbeat) window.clearInterval(heartbeat);
        stopSilence();
        if (capTimer) window.clearInterval(capTimer);
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
        stopSilence();
        if (capTimer) window.clearInterval(capTimer);
        const blob = await new Promise<Blob>((resolve) => {
          recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          if (recorder.state !== "inactive") recorder.stop();
          else resolve(new Blob(chunks, { type: "audio/webm" }));
        });
        await context.close().catch(() => undefined);
        const ended = await postJson<{ billableSeconds?: number; recap?: LeadRecap }>("/api/interviewer/sessions/end", { token, sessionId: session });
        if (ended.data.recap) setRecap(ended.data.recap);
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
              await postJson("/api/interviewer/recording/complete", {
                token,
                sessionId: session,
                path: upload.data.path,
                fileSize: blob.size,
              });
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
              if ((content as { booked?: boolean }).booked) bookedRef.current = true;
            } else if (fn.name === "show_slide") {
              const shown = await postJson<{ shown?: boolean; url?: string | null; title?: string; slideNumber?: number; note?: string }>(
                "/api/interviewer/slides",
                {
                  token,
                  sessionId: session,
                  slideNumber: (args as { slide_number?: number }).slide_number,
                  deckId: deckRef.current,
                  reason: (args as { reason?: string }).reason,
                },
              );
              if (shown.data.url || shown.data.title) {
                const match = slideIndexRef.current.find((item) => item.number === Number(shown.data.slideNumber));
                setSlideUrl(shown.data.url || match?.url || "");
                setSlideLabel(shown.data.title || match?.title || `Slide ${shown.data.slideNumber || ""}`);
                setSlideSlogan(match?.slogan || "");
                if (shown.data.slideNumber) {
                  slideNumberRef.current = Number(shown.data.slideNumber);
                  setSlideNumber(Number(shown.data.slideNumber));
                }
              }
              content = "shown";
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
            const reply = fn.name === "show_slide" ? "shown" : toolReplyForAgent(fn.name || "", content);
            const safe = stripAgentContext(reply) || "ok";
            agentSocket.send(JSON.stringify({
              type: "FunctionCallResponse",
              id: fn.id,
              name: fn.name,
              content: safe,
            }));
            void postJson("/api/interviewer/utterances", {
              token,
              sessionId: session,
              utterances: [{
                speaker: "agent",
                text: `Voice log: ${fn.name || "tool"} response: ${safe}`.slice(0, 500),
                ts: new Date().toISOString(),
                utteranceId: `voicelog${Date.now()}${fn.id || "x"}`.replace(/[^a-z0-9]/gi, "").slice(0, 80),
              }],
            });
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
        if (message.type === "Welcome") {
          const settings = ready.data.settings as { agent?: { think?: { prompt?: string }; greeting?: string } } | null;
          if (settings?.agent?.think?.prompt) settings.agent.think.prompt = stripAgentContext(settings.agent.think.prompt);
          if (settings?.agent?.greeting) settings.agent.greeting = stripAgentContext(settings.agent.greeting);
          agentSocket.send(JSON.stringify(settings));
        }
        else if (message.type === "SettingsApplied") {
          applied = true;
          setConnecting(false);
          setPhase("live");
        }         else if (message.type === "UserStartedSpeaking") {
          bargeIn();
          agentTurnRef.current = null;
          silenceRef.current.speaking = true;
          silenceRef.current.lastActivityAt = Date.now();
        } else if (message.type === "ConversationText" && message.content && (message.role === "assistant" || message.role === "agent")) {
          acceptAgent(message.content);
        }
        else if (message.type === "Error") {
          const detail = { message: message.description || "", code: message.code };
          if (isDeepgramConcurrencyRefusal(detail)) void returnToQueue(true, "");
          else if (!applied) void returnToQueue(false, "We could not open the voice connection. You are still in the queue.");
        } else if (message.type === "FunctionCallRequest") void handleFunctions(message.functions || []);
        else if (message.type === "AgentAudioDone") {
          silenceRef.current.speaking = false;
          silenceRef.current.lastActivityAt = Date.now();
          silenceRef.current.lastSpeaker = "agent";
          if (endAfterAudio) void finish();
        }
      };
      agentSocket.onclose = (event) => {
        if (stopped || applied) return;
        const detail = { closeCode: event.code, message: event.reason };
        void returnToQueue(isDeepgramConcurrencyRefusal(detail), "We could not open the voice connection. You are still in the queue.");
      };

      const micOnly = new MediaStream(stream.getAudioTracks().slice(0, 1));
      holdPollRef.current = true;
      stopLead = startLeadListener({
        stream: micOnly,
        token: ready.data.listenToken,
        handlers: {
          onDecision: (decision) => {
            setInterim(decision.interim);
            if (decision.interim) {
              silenceRef.current.speaking = true;
              silenceRef.current.lastActivityAt = Date.now();
            }
            const heard = decision.lock || decision.revise;
            if (heard) {
              silenceRef.current.lastActivityAt = Date.now();
              silenceRef.current.lastSpeaker = "lead";
              silenceRef.current.speaking = false;
              if (isHoldRequest(heard.text)) {
                if (silenceRef.current.holdSince == null) {
                  silenceRef.current.holdSince = Date.now();
                  silenceRef.current.phase = "holding";
                  say("No problem, take your time.", "queue");
                }
              } else {
                silenceRef.current.holdSince = null;
                silenceRef.current.phase = "clear";
              }
            }
            if (decision.lock && !tipSaid && !looksLikeSpeakerEcho(decision.lock.text, recentAgentRef.current)) {
              tipSaid = true;
              say("Quick tip, if there's background noise I can get a bit confused, so feel free to mute when you're not talking to me.", "queue");
            }
            if (decision.lock) acceptLead(decision.lock);
            if (decision.revise) acceptLead(decision.revise);
          },
          onOverlap: () => {
            silenceRef.current.lastActivityAt = Date.now();
            silenceRef.current.lastSpeaker = "lead";
            suggestNoise();
          },
          onRefusal: (detail) => {
            if (isDeepgramConcurrencyRefusal(detail)) void returnToQueue(true, "");
          },
        },
      });

      let tipSaid = false;
      let endingForSilence = false;
      silenceTimer = window.setInterval(() => {
        const silence = silenceRef.current;
        const speaking = silence.speaking || nextAt > context.currentTime + 0.05;
        const cue = nextSilenceCue({ ...silence, now: Date.now(), muted: mutedRef.current, speaking });
        if (cue === "check") {
          silence.phase = "checked";
          say("Are you still there?");
        } else if (cue === "warn") {
          silence.phase = "warned";
          say("I'll end the call shortly if I don't hear from you.");
        } else if (cue === "hold-check") {
          silence.phase = "hold-checked";
          say("I'm still here whenever you're ready.", "queue");
        } else if (cue === "mute-check") {
          silence.muteChecked = true;
          say("You're still muted. Unmute when you're ready, and I'll be here.", "queue");
        } else if ((cue === "end" || cue === "mute-end") && !endingForSilence) {
          endingForSilence = true;
          say(cue === "mute-end"
            ? "You've been muted for a while, so I'll let you go. You're welcome back whenever you're ready."
            : "I'll let you go for now. You're welcome back whenever you're ready.");
          endAfterAudio = true;
          window.setTimeout(() => { if (!settling) void finish(); }, 8000);
        }
      }, 1000);
      heartbeat = window.setInterval(() => {
        void postJson<{ state?: string }>("/api/interviewer/slots/heartbeat", { token, sessionId: session }).then(({ data }) => {
          if (data.state === "time_limit" && phaseRef.current === "live" && !settling) {
            say(TIME_LIMIT_GOODBYE);
            window.setTimeout(() => { if (!settling) void finish(); }, 4000);
          } else if (data.state === "lost" && phaseRef.current === "live") void finish();
        });
      }, 15000);
      const endsAt = Date.parse(String(ready.data.callEndsAt || ""));
      let warned = false;
      let endingForLimit = false;
      const clock = window.setInterval(() => {
        if (!Number.isFinite(endsAt)) return;
        const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        setRemainingSeconds(left);
        if (left <= 120 && left > 0 && !warned) {
          warned = true;
          say(twoMinuteLine(bookedRef.current));
        }
        if (left <= 0 && !endingForLimit) {
          endingForLimit = true;
          say(TIME_LIMIT_GOODBYE);
          window.setTimeout(() => { if (!settling) void finish(); }, 4000);
        }
      }, 1000);
      capTimer = clock;

      teardownRef.current = (mode) => {
        if (mode === "end") void finish();
        else void returnToQueue(false, "");
      };
    } finally {
      connectingRef.current = false;
    }
  }, [acceptAgent, acceptLead, rememberQueue, token]);

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
    if (endingSoon.current) {
      teardownRef.current?.("end");
      return;
    }
    setEndAsk(true);
  }, []);

  const cancelHangUp = useCallback(() => setEndAsk(false), []);

  const confirmHangUp = useCallback(() => {
    setEndAsk(false);
    if (endingSoon.current) {
      teardownRef.current?.("end");
      return;
    }
    endingSoon.current = true;
    const socket = agentSocketRef.current;
    const declined = leadDeclinedDemo(leadLinesRef.current);
    const offer = !bookedRef.current && !declined;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "InjectUserMessage", content: "The lead pressed End call" }));
      socket.send(JSON.stringify({
        type: "InjectAgentMessage",
        message: offer
          ? "No problem. Before you go, would a quick demo be useful?"
          : "Thanks for your time. Take care.",
      }));
    }
    window.setTimeout(() => teardownRef.current?.("end"), offer ? 5000 : 2500);
  }, []);

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    setMutedState(next);
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    silenceRef.current.mutedSince = next ? Date.now() : null;
    silenceRef.current.muteChecked = false;
    const socket = agentSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "UpdatePrompt",
        prompt: next
          ? "The caller has muted their microphone. They are still there. Do not speak until they unmute."
          : "The caller has unmuted. Continue when they speak. The earlier mute instruction no longer applies.",
      }));
    }
  }, []);

  const chooseSlide = useCallback((slide: SlideChoice) => {
    const title = slide.title || `Slide ${slide.number}`;
    manualSlideUntil.current = Date.now() + 20000;
    slideNumberRef.current = slide.number;
    setSlideNumber(slide.number);
    setSlideUrl(slide.url || "");
    setSlideLabel(title);
    setSlideSlogan(slide.slogan || "");
    const session = sessionRef.current;
    if (session) {
      void postJson("/api/interviewer/slides", {
        token,
        sessionId: session,
        deckId: deckRef.current,
        slideNumber: slide.number,
        reason: `Lead clicked the slide "${title}"`.slice(0, 240),
      });
    }
    const socket = agentSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const note = `The lead clicked the slide "${title}" and wants to talk about it now.`;
      socket.send(JSON.stringify({
        type: "UpdatePrompt",
        prompt: `${note} Acknowledge that in one short line, then talk about the slide from the notes. Do not read this instruction aloud.`,
      }));
      socket.send(JSON.stringify({ type: "InjectUserMessage", content: note }));
    }
  }, [token]);

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
    interim,
    echoes,
    slideUrl,
    slideLabel,
    slideSlogan,
    slideNumber,
    slideIndex,
    chooseSlide,
    remainingSeconds,
    billableSeconds,
    muted,
    join,
    endAsk,
    recap,
    hangUp,
    confirmHangUp,
    cancelHangUp,
    setMuted,
    leaveQueue,
  };
}
