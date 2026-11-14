"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { floatToPcm16, playOfferChime, resampleLinear } from "@/components/interviewer/audio";
import { startLeadListener } from "@/components/interviewer/lead-listener";
import { isDeepgramConcurrencyRefusal } from "@/lib/interviewer/concurrency";
import { leadDeclinedDemo } from "@/lib/interviewer/call-close";
import { HUMAN_TEAM_OFFER, TIME_LIMIT_GOODBYE, TIME_WARNING_INJECT, shouldSpeakTimeWarning, twoMinuteLine } from "@/lib/interviewer/call-limit";
import { sendSlideClickFirst, slideClickDecision, slideClickSpeech } from "@/lib/interviewer/slide-click";
import { isHoldRequest, nextSilenceCue, type SilencePhase } from "@/lib/interviewer/silence";
import {
  agentTurnExtends,
  looksLikeSpeakerEcho,
  utteranceKey,
  type LockedUtterance,
} from "@/lib/interviewer/listen-transcript";
import { stripAgentContext, toSpokenPlain, toolReplyForAgent } from "@/lib/interviewer/spoken-text";
import { forSpeech, forTranscript } from "@/lib/interviewer/pronunciations";
import { businessProfileNote, emptyBusinessProfile, noteBusiness, type BusinessProfile } from "@/lib/interviewer/business-profile";
import { catalogFromSlides, coverInterests, noteInterests, privateCoverNote, spokenReminder, type AgendaItem } from "@/lib/interviewer/interest-agenda";
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
export type LeadRecap = {
  summary: string;
  businessType: string;
  howTheyServe: string;
  fits: Array<{ title: string; why: string; slideNumber: number | null; slideTitle: string }>;
  answers: Array<{ question: string; answer: string }>;
  booked: boolean;
  when: string | null;
  nextStep: string;
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

export function useInterviewerCall(token: string, capMinutes = "") {
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
  const [ending, setEnding] = useState(false);
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
  const slideQueue = useRef<Array<{ number: number; url: string; title: string; slogan: string }>>([]);
  const lastSlideAt = useRef(0);
  const advanceTimer = useRef<number | null>(null);
  const advanceQueueRef = useRef<(speech: string) => boolean>(() => false);
  const agendaRef = useRef<AgendaItem[]>([]);
  const profileRef = useRef<BusinessProfile>(emptyBusinessProfile());
  const leadQuestionAt = useRef(Date.now());
  const remindTimer = useRef<number | null>(null);
  const remindRef = useRef<(speech: string) => void>(() => undefined);
  const greetingDoneRef = useRef(false);
  const pendingInjectRef = useRef("");
  const interruptRef = useRef<() => void>(() => undefined);
  const coveredSlidesRef = useRef<Set<number>>(new Set());
  const [seenSlides, setSeenSlides] = useState<number[]>([]);
  const rememberSeen = useCallback((number: number) => {
    if (!number) return;
    coveredSlidesRef.current.add(number);
    setSeenSlides((current) => current.includes(number) ? current : [...current, number]);
  }, []);
  const lastClickRef = useRef({ number: 0, at: 0 });
  const clickMarkRef = useRef<number | null>(null);
  const [slideAudioMs, setSlideAudioMs] = useState<number | null>(null);
  const endingSoon = useRef(false);
  const goodbyeTimer = useRef<number | null>(null);
  const offerOpen = useRef(false);
  const offerReplied = useRef(false);
  const goodbyeOwnsEnd = useRef(false);
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
    profileRef.current = noteBusiness(text, profileRef.current);
    if (/\?|\b(what|how|why|when|where|who|can you|do you)\b/i.test(text)) leadQuestionAt.current = Date.now();
    agendaRef.current = noteInterests(text, agendaRef.current, catalogFromSlides(slideIndexRef.current));
    saveCaption({ id: utterance.id, speaker: "lead", text });
  }, [saveCaption]);

  const acceptAgent = useCallback((text: string) => {
    const clean = forTranscript(toSpokenPlain(text));
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
    remindRef.current(clean);
    if (advanceQueueRef.current(clean)) return;
    if (slideQueue.current.length) return;
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
        ...(capMinutes ? { capMinutes } : {}),
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
        rememberSeen(openingNumber);
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
      interruptRef.current = bargeIn;
      greetingDoneRef.current = false;
      const releaseGreeting = () => {
        if (greetingDoneRef.current) return;
        greetingDoneRef.current = true;
        const pending = pendingInjectRef.current;
        pendingInjectRef.current = "";
        if (pending && agentSocket.readyState === WebSocket.OPEN) {
          agentSocket.send(JSON.stringify({ type: "InjectUserMessage", content: pending }));
        }
        if (slideQueue.current.length) {
          const next = slideQueue.current.shift();
          if (next) showOne(next);
        }
      };
      const greetingWatch = window.setTimeout(releaseGreeting, 15000);
      const playAgent = (pcm: ArrayBuffer) => {
        if (clickMarkRef.current != null) {
          setSlideAudioMs(Math.round(performance.now() - clickMarkRef.current));
          clickMarkRef.current = null;
        }
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
      const say = (line: string, behavior: "default" | "queue" | "interrupt" = "default") => {
        if (agentSocket.readyState !== WebSocket.OPEN) return false;
        const message = forSpeech(stripAgentContext(line));
        if (!message) return false;
        agentSocket.send(JSON.stringify({ type: "InjectAgentMessage", behavior, message }));
        return true;
      };
      let warningHeard = false;
      let warningDue = false;
      let warningSentAt = 0;
      let endingForLimit = false;
      const speakWarning = () => {
        if (!warningDue || warningHeard || Date.now() - warningSentAt < 2000) return false;
        warningSentAt = Date.now();
        const privateNote = privateCoverNote(agendaRef.current);
        if (privateNote) note(`Note for you only. Do not read this note aloud. The call is in its last two minutes. ${privateNote}`);
        return say(twoMinuteLine(bookedRef.current), TIME_WARNING_INJECT);
      };
      const closeForLimit = () => {
        if (settling) return;
        say(TIME_LIMIT_GOODBYE, "interrupt");
        window.setTimeout(() => { if (!settling) void finish(); }, 5000);
      };
      const beginLimitClose = () => {
        if (endingForLimit || settling) return;
        endingForLimit = true;
        warningDue = true;
        const heard = warningHeard;
        if (!heard) speakWarning();
        window.setTimeout(closeForLimit, heard ? 0 : 9000);
      };
      const note = (instruction: string) => {
        if (agentSocket.readyState !== WebSocket.OPEN) return;
        const prompt = [businessProfileNote(profileRef.current), instruction].filter(Boolean).join("\n\n");
        agentSocket.send(JSON.stringify({
          type: "UpdatePrompt",
          prompt,
        }));
      };
      remindRef.current = (speech: string) => {
        agendaRef.current = coverInterests(speech, agendaRef.current, catalogFromSlides(slideIndexRef.current));
        if (remindTimer.current) window.clearTimeout(remindTimer.current);
        remindTimer.current = window.setTimeout(() => {
          if (!greetingDoneRef.current || goodbyeOwnsEnd.current) return;
          const privateNote = privateCoverNote(agendaRef.current);
          const spoken = spokenReminder(agendaRef.current);
          if (!privateNote || !spoken) return;
          note(privateNote);
          say(spoken);
        }, 2500);
      };
      const suggestNoise = () => {
        const now = Date.now();
        if (now - silenceRef.current.noiseAt < 180000) return;
        silenceRef.current.noiseAt = now;
        say("If you're chatting with someone there, feel free to mute your mic and unmute when you're ready, so I don't get confused.", "queue");
      };
      processor.onaudioprocess = (event) => {
        if (!applied || !greetingDoneRef.current || agentSocket.readyState !== WebSocket.OPEN || mutedRef.current) return;
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
        window.clearTimeout(greetingWatch);
        if (remindTimer.current) window.clearTimeout(remindTimer.current);
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

      const boundedPost = async <T,>(url: string, body: unknown, ms: number): Promise<{ ok: boolean; data: T }> => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), ms);
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const data = await response.json().catch(() => ({}));
          return { ok: response.ok, data: data as T };
        } catch {
          return { ok: false, data: {} as T };
        } finally {
          window.clearTimeout(timer);
        }
      };
      const finish = async () => {
        if (goodbyeTimer.current) window.clearTimeout(goodbyeTimer.current);
        goodbyeTimer.current = null;
        offerOpen.current = false;
        goodbyeOwnsEnd.current = false;
        setEndAsk(false);
        setEnding(false);
        setConnecting(false);
        setPhase("ended");
        if (settling) return;
        settling = true;
        holdPollRef.current = false;
        stopSockets();
        stopLead();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        if (heartbeat) window.clearInterval(heartbeat);
        stopSilence();
        if (capTimer) window.clearInterval(capTimer);
        teardownRef.current = null;
        const blob = await new Promise<Blob>((resolve) => {
          const giveUp = window.setTimeout(() => resolve(new Blob(chunks, { type: "audio/webm" })), 800);
          recorder.onstop = () => {
            window.clearTimeout(giveUp);
            resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          };
          try {
            if (recorder.state !== "inactive") recorder.stop();
            else {
              window.clearTimeout(giveUp);
              resolve(new Blob(chunks, { type: "audio/webm" }));
            }
          } catch {
            window.clearTimeout(giveUp);
            resolve(new Blob(chunks, { type: "audio/webm" }));
          }
        });
        await context.close().catch(() => undefined);
        const ended = await boundedPost<{ billableSeconds?: number; recap?: LeadRecap }>("/api/interviewer/sessions/end", { token, sessionId: session }, 8000);
        if (ended.data.recap) setRecap(ended.data.recap);
        if (Number.isFinite(Number(ended.data.billableSeconds))) setBillableSeconds(Number(ended.data.billableSeconds || 0));
        if (blob.size > 0) {
          void boundedPost<{ signedUrl?: string; path?: string }>("/api/interviewer/recording", {
            token,
            sessionId: session,
            fileSize: blob.size,
          }, 8000).then(async (upload) => {
            if (!upload.ok || !upload.data.signedUrl || !upload.data.path) return;
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), 8000);
            try {
              const put = await fetch(upload.data.signedUrl, {
                method: "PUT",
                headers: { "Content-Type": blob.type || "audio/webm", "x-upsert": "true" },
                body: blob,
                signal: controller.signal,
              });
              if (put.ok) {
                await boundedPost("/api/interviewer/recording/complete", {
                  token,
                  sessionId: session,
                  path: upload.data.path,
                  fileSize: blob.size,
                }, 8000);
              }
            } catch { /* the call is already closed */ }
            finally { window.clearTimeout(timer); }
          });
        }
      };

      const showOne = (slide: { number: number; url: string; title: string; slogan: string }) => {
        const known = slideIndexRef.current.find((item) => item.number === slide.number);
        agendaRef.current = coverInterests(`${slide.title} ${(known?.keywords || []).join(" ")}`, agendaRef.current, catalogFromSlides(slideIndexRef.current));
        rememberSeen(slide.number);
        slideNumberRef.current = slide.number;
        setSlideNumber(slide.number);
        setSlideUrl(slide.url);
        setSlideLabel(slide.title);
        setSlideSlogan(slide.slogan);
        lastSlideAt.current = Date.now();
        if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
        if (!slideQueue.current.length) return;
        advanceTimer.current = window.setTimeout(() => {
          const next = slideQueue.current.shift();
          if (next) showOne(next);
        }, 8000);
      };
      const queueSlide = (slide: { number: number; url: string; title: string; slogan: string }) => {
        if (!greetingDoneRef.current) {
          slideQueue.current.push(slide);
          return;
        }
        const burst = slideQueue.current.length > 0 || (lastSlideAt.current > 0 && Date.now() - lastSlideAt.current < 1500);
        if (burst && slideNumberRef.current !== slide.number) {
          slideQueue.current.push(slide);
          if (!advanceTimer.current) {
            advanceTimer.current = window.setTimeout(() => {
              const next = slideQueue.current.shift();
              if (next) showOne(next);
            }, 8000);
          }
          return;
        }
        showOne(slide);
      };
      advanceQueueRef.current = (speech: string) => {
        if (!slideQueue.current.length) return false;
        const options = slideQueue.current.map((item) => {
          const known = slideIndexRef.current.find((slide) => slide.number === item.number);
          return { number: item.number, keywords: known?.keywords?.length ? known.keywords : [item.title.toLowerCase()] };
        });
        const hit = options.findIndex((option) => matchSpokenSlide(speech, [option], -1) === option.number);
        if (hit < 0) return false;
        const next = slideQueue.current[hit];
        slideQueue.current = slideQueue.current.slice(hit + 1);
        showOne(next);
        return true;
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
              const number = Number((args as { slide_number?: number }).slide_number);
              const match = slideIndexRef.current.find((item) => item.number === number);
              if (number) {
                queueSlide({
                  number,
                  url: match?.url || "",
                  title: match?.title || `Slide ${number}`,
                  slogan: match?.slogan || "",
                });
              }
              content = "shown";
              void postJson("/api/interviewer/slides", {
                token,
                sessionId: session,
                slideNumber: number,
                deckId: deckRef.current,
                reason: (args as { reason?: string }).reason,
              }).then((shown) => {
                const url = shown.data && typeof shown.data === "object" ? (shown.data as { url?: string | null }).url : "";
                if (url && slideNumberRef.current === number) setSlideUrl(url);
              });
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
          if (!greetingDoneRef.current) return;
          bargeIn();
          agentTurnRef.current = null;
          silenceRef.current.speaking = true;
          silenceRef.current.lastActivityAt = Date.now();
        } else if (message.type === "InjectionRefused") {
          if (warningDue && !warningHeard) speakWarning();
        } else if (message.type === "ConversationText" && message.content && (message.role === "assistant" || message.role === "agent")) {
          if (/two minutes left/i.test(message.content)) warningHeard = true;
          acceptAgent(message.content);
        }
        else if (message.type === "Error") {
          const detail = { message: message.description || "", code: message.code };
          if (isDeepgramConcurrencyRefusal(detail)) void returnToQueue(true, "");
          else if (!applied) void returnToQueue(false, "We could not open the voice connection. You are still in the queue.");
        } else if (message.type === "FunctionCallRequest") void handleFunctions(message.functions || []);
        else if (message.type === "AgentAudioDone") {
          releaseGreeting();
          silenceRef.current.speaking = false;
          silenceRef.current.lastActivityAt = Date.now();
          silenceRef.current.lastSpeaker = "agent";
          if (endAfterAudio && !goodbyeOwnsEnd.current) void finish();
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
              if (offerOpen.current && !offerReplied.current && heard.text.trim()) {
                offerReplied.current = true;
                if (goodbyeTimer.current) window.clearTimeout(goodbyeTimer.current);
                goodbyeTimer.current = window.setTimeout(() => { void finish(); }, 45000);
              }
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
      let lastPaceAt = 0;
      const callStartedAt = Date.now();
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
        const agentTalking = nextAt > context.currentTime + 0.05;
        const slideQuiet = Date.now() - Math.max(lastSlideAt.current, callStartedAt);
        if (greetingDoneRef.current && agentTalking && !silence.speaking && slideQuiet > 40000 && Date.now() - lastPaceAt > 40000 && Date.now() - leadQuestionAt.current > 12000) {
          lastPaceAt = Date.now();
          note("Note for you only. Do not read this aloud. About 40 seconds have passed on this slide. Acknowledge what they just said in one line, then call show_slide for the next relevant feature. One or two punchy sentences. Do not go back to a long intro. Skip setup slides unless they asked.");
        }
      }, 1000);
      heartbeat = window.setInterval(() => {
        void postJson<{ state?: string }>("/api/interviewer/slots/heartbeat", { token, sessionId: session, ...(capMinutes ? { capMinutes } : {}) }).then(({ data }) => {
          if (data.state === "time_limit" && phaseRef.current === "live" && !settling) {
            beginLimitClose();
          } else if (data.state === "lost" && phaseRef.current === "live") void finish();
        });
      }, 15000);
      const endsAt = Date.parse(String(ready.data.callEndsAt || ""));
      const clock = window.setInterval(() => {
        if (!Number.isFinite(endsAt)) return;
        const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        setRemainingSeconds(left);
        if (shouldSpeakTimeWarning(left, warningHeard)) {
          warningDue = true;
          speakWarning();
        }
        if (left <= 0) beginLimitClose();
      }, 1000);
      capTimer = clock;

      teardownRef.current = (mode) => {
        if (mode === "end") void finish();
        else void returnToQueue(false, "");
      };
    } finally {
      connectingRef.current = false;
    }
  }, [acceptAgent, acceptLead, capMinutes, rememberQueue, rememberSeen, token]);

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
      if (goodbyeTimer.current) window.clearTimeout(goodbyeTimer.current);
      goodbyeTimer.current = null;
      teardownRef.current?.("end");
      return;
    }
    setEndAsk(true);
  }, []);

  const cancelHangUp = useCallback(() => setEndAsk(false), []);

  const confirmHangUp = useCallback(() => {
    if (endingSoon.current) {
      if (goodbyeTimer.current) window.clearTimeout(goodbyeTimer.current);
      goodbyeTimer.current = null;
      teardownRef.current?.("end");
      return;
    }
    setEndAsk(false);
    setEnding(true);
    endingSoon.current = true;
    goodbyeOwnsEnd.current = true;
    const socket = agentSocketRef.current;
    const declined = leadDeclinedDemo(leadLinesRef.current);
    const offer = !bookedRef.current && !declined;
    offerOpen.current = offer;
    offerReplied.current = false;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "InjectUserMessage", content: "The lead pressed End call" }));
        socket.send(JSON.stringify({
          type: "InjectAgentMessage",
          message: offer ? HUMAN_TEAM_OFFER : "Thanks for your time. Take care.",
        }));
      } catch { /* the timeout still closes the call */ }
    }
    if (goodbyeTimer.current) window.clearTimeout(goodbyeTimer.current);
    goodbyeTimer.current = window.setTimeout(() => { teardownRef.current?.("end"); }, 8000);
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
    const now = Date.now();
    const decision = slideClickDecision({
      number: slide.number,
      current: slideNumberRef.current,
      covered: coveredSlidesRef.current.has(slide.number),
      lastNumber: lastClickRef.current.number,
      lastAt: lastClickRef.current.at,
      now,
    });
    if (decision === "ignore-current" || decision === "ignore-repeat") return;
    lastClickRef.current = { number: slide.number, at: now };
    const title = slide.title || `Slide ${slide.number}`;
    const speech = slideClickSpeech(title, slide.points || [], decision === "ask");
    const socket = agentSocketRef.current;
    clickMarkRef.current = performance.now();
    sendSlideClickFirst(() => {
      if (!greetingDoneRef.current) {
        pendingInjectRef.current = speech;
        return;
      }
      interruptRef.current();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "InjectUserMessage", content: speech }));
      }
    }, () => {
      manualSlideUntil.current = Date.now() + 20000;
      rememberSeen(slide.number);
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
    });
  }, [rememberSeen, token]);

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
    seenSlides,
    chooseSlide,
    remainingSeconds,
    billableSeconds,
    muted,
    join,
    endAsk,
    ending,
    recap,
    hangUp,
    confirmHangUp,
    cancelHangUp,
    setMuted,
    leaveQueue,
    slideAudioMs,
  };
}
