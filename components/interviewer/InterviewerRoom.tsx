"use client";

import { useEffect, useRef, useState } from "react";

import { INTERVIEWER_MIC_CONSTRAINTS } from "@/lib/interviewer/listen-url";
import { useInterviewerCall } from "@/components/interviewer/useInterviewerCall";

type Slot = { start: string; end: string; label: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await response.json().catch(() => ({})) as T;
}

export default function InterviewerRoom({
  token,
  campaignName,
}: {
  token: string;
  campaignName: string;
}) {
  const call = useInterviewerCall(token);
  const [micReady, setMicReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const holdRef = useRef<HTMLAudioElement | null>(null);
  const [holdSrc, setHoldSrc] = useState("/interviewer/hold-loop.wav");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookingNote, setBookingNote] = useState("");
  const [bookingSaved, setBookingSaved] = useState<boolean | null>(null);
  const [ownerDebug, setOwnerDebug] = useState(false);
  const [canDebug, setCanDebug] = useState(false);

  const meterRef = useRef<number | ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (meterRef.current) window.clearInterval(meterRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (call.phase !== "mic" && meterRef.current) {
      window.clearInterval(meterRef.current);
      meterRef.current = null;
    }
  }, [call.phase]);

  useEffect(() => {
    const audio = holdRef.current;
    if (!audio) return;
    if (call.phase === "waiting") void audio.play().catch(() => undefined);
    else audio.pause();
  }, [call.phase, holdSrc]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/crm/interviewer/campaigns", { credentials: "same-origin", cache: "no-store" })
      .then((response) => {
        if (!cancelled) setCanDebug(response.ok);
      })
      .catch(() => {
        if (!cancelled) setCanDebug(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enableMic = async () => {
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: INTERVIEWER_MIC_CONSTRAINTS,
      });
      streamRef.current = stream;
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      meterRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
        setMicLevel(Math.min(100, peak * 2));
      }, 120);
      setMicReady(true);
    } catch {
      setMicError("The microphone is blocked. Allow it in the browser, then try again.");
    }
  };

  const suggest = async () => {
    if (!call.sessionId) return;
    setBookingNote("");
    const data = await postJson<{ slots?: Slot[]; note?: string }>("/api/interviewer/book", {
      token,
      sessionId: call.sessionId,
      action: "suggest",
    });
    setSlots(data.slots || []);
    setBookingNote(data.note || "");
  };

  const book = async (slot: Slot) => {
    if (!call.sessionId || bookingSaved === false) return;
    const data = await postJson<{ booked?: boolean; saved?: boolean; note?: string }>("/api/interviewer/book", {
      token,
      sessionId: call.sessionId,
      action: "book",
      start: slot.start,
      end: slot.end,
    });
    setBookingNote(data.note || "");
    setBookingSaved(data.saved !== false && data.booked === true);
    if (data.booked) setSlots([]);
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-10">
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-amber">Private conversation</p>
      <h1 className="mt-3 font-display text-4xl text-bone">{campaignName}</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        A short voice conversation. You can interrupt at any time. Queue time is not charged.
      </p>

      {call.phase === "mic" && !call.connecting ? (
        <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-6">
          <h2 className="font-display text-2xl text-bone">Check your microphone</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Allow the microphone, then speak. The bar should move before you join.
          </p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-ink">
            <div className="h-full bg-amber transition-all" style={{ width: `${micLevel}%` }} />
          </div>
          {micError ? <p className="mt-3 text-sm text-rust">{micError}</p> : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="rounded-full bg-panel2 px-4 py-2 text-sm text-bone" onClick={() => void enableMic()}>
              {micReady ? "Microphone allowed" : "Allow microphone"}
            </button>
            <button
              type="button"
              disabled={!micReady || !streamRef.current}
              className="rounded-full bg-amber px-4 py-2 text-sm text-ink disabled:opacity-40"
              onClick={() => streamRef.current && void call.join(streamRef.current)}
            >
              Join the conversation
            </button>
          </div>
        </section>
      ) : null}

      {call.phase === "waiting" || call.connecting ? (
        <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-6">
          <h2 className="font-display text-2xl text-bone">
            {call.connecting ? "Connecting you now" : "Holding your place"}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {call.position > 0 ? `You are number ${call.position} in the queue.` : "You are at the front of the queue."}
          </p>
          <p className="mt-1 text-sm text-bone">{call.waitLabel}</p>
          {call.calmMessage ? <p className="mt-3 text-sm text-bone">{call.calmMessage}</p> : null}
          <audio
            ref={holdRef}
            src={holdSrc}
            controls
            loop
            preload="auto"
            onError={() => {
              if (holdSrc.endsWith("hold-loop.wav")) setHoldSrc("/interviewer/hold-loop-PLACEHOLDER.wav");
            }}
          />
          <p className="mt-4 text-xs leading-5 text-muted">
            A one-minute branded hold loop will replace the placeholder audio. This is not a spinner.
          </p>
          {call.overTenMinutes ? (
            <div className="mt-5">
              <p className="text-sm text-bone">Over 10 minutes. You can book a time instead.</p>
              <button type="button" className="mt-3 rounded-full bg-amber px-4 py-2 text-sm text-ink" onClick={() => void suggest()}>
                Book a time
              </button>
            </div>
          ) : null}
          {bookingNote ? <p className="mt-3 text-sm text-bone">{bookingNote}</p> : null}
          {bookingSaved === false ? (
            <p className="mt-2 text-sm text-rust">Check the calendar before booking again. The meeting may already be there.</p>
          ) : null}
          <ul className="mt-3 space-y-2">
            {slots.map((slot) => (
              <li key={slot.start}>
                <button type="button" className="text-sm text-amber underline" onClick={() => void book(slot)} disabled={bookingSaved === false}>
                  {slot.label}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mt-6 text-sm text-muted underline" onClick={() => void call.leaveQueue()}>
            Leave the queue
          </button>
        </section>
      ) : null}

      {call.phase === "live" ? (
        <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-6">
          <h2 className="font-display text-2xl text-bone">You are connected</h2>
          <p className="mt-2 text-sm text-muted">Speak normally. You can interrupt the interviewer.</p>
          <ul className="mt-5 max-h-80 space-y-3 overflow-auto">
            {call.captions.map((line) => (
              <li key={line.id} className="text-sm leading-6 text-bone">
                <span className="mr-2 font-mono text-[0.65rem] uppercase tracking-wider text-amber">
                  {line.speaker === "agent" ? "Interviewer" : "You"}
                </span>
                {line.text}
              </li>
            ))}
          </ul>
          {canDebug ? (
            <div className="mt-4">
              <button
                type="button"
                className="text-xs text-muted underline"
                onClick={() => setOwnerDebug((current) => !current)}
              >
                {ownerDebug ? "Hide transcript debug" : "Show transcript debug"}
              </button>
              {ownerDebug ? (
                <div className="mt-2 rounded-xl border border-edge bg-ink/40 p-3 text-xs leading-5 text-muted">
                  <p>Interim, replaced in place: {call.interim || "—"}</p>
                  <p className="mt-2">Saved lines: {call.captions.length}. Echoes dropped: {call.echoes.length}.</p>
                  {call.echoes.map((echo, index) => (
                    <p key={`${index}-${echo.slice(0, 24)}`} className="mt-1">Echo not saved: {echo}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="mt-6 rounded-full bg-rust px-4 py-2 text-sm text-ink" onClick={call.hangUp}>
            End conversation
          </button>
        </section>
      ) : null}

      {call.phase === "ended" ? (
        <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-6">
          <h2 className="font-display text-2xl text-bone">Thank you</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {call.billableSeconds === null
              ? "The conversation is closed."
              : `Connected time recorded: ${call.billableSeconds} seconds. Waiting time was not included.`}
          </p>
          {bookingNote ? <p className="mt-3 text-sm text-bone">{bookingNote}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
