"use client";

import { useEffect, useRef, useState } from "react";

import styles from "@/components/interviewer/interviewa.module.css";
import { formatCountdown } from "@/lib/interviewer/call-limit";
import { presentTranscript } from "@/lib/interviewer/transcript-display";
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
  const [slideBroken, setSlideBroken] = useState(false);
  const [talkOpen, setTalkOpen] = useState(true);

  const meterRef = useRef<number | ReturnType<typeof setInterval> | null>(null);
  const showSlideImage = Boolean(call.slideUrl) && !slideBroken;

  useEffect(() => {
    setSlideBroken(false);
  }, [call.slideUrl]);

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

  if (call.phase === "live") {
    const points = (call.slideIndex.find((item) => item.number === call.slideNumber)?.points || []).slice(0, 5);
    return (
      <main className={styles.callScreen}>
        <header className={styles.callTop}>
          <p>Private conversation · {campaignName}</p>
          <button type="button" className={styles.transcriptToggle} onClick={() => setTalkOpen((open) => !open)}>
            {talkOpen ? "Hide transcript" : "Transcript"}
          </button>
        </header>
        <section className={talkOpen ? styles.callStage : styles.callStageWide}>
          {call.slideIndex.length ? (
            <ol className={styles.slideList}>
              {call.slideIndex.map((slide) => {
                const title = slide.title || "Untitled";
                return (
                  <li key={slide.number}>
                    <button
                      type="button"
                      className={`${styles.slideRow} ${slide.number === call.slideNumber ? styles.slideRowActive : ""}`}
                      title={title}
                      onClick={() => call.chooseSlide(slide)}
                    >
                      {slide.url ? <img src={slide.url} alt="" className={styles.slideThumb} /> : <span className={styles.slideThumb} aria-hidden="true" />}
                      <span className={styles.slideCopy}>
                        <span className={styles.slideHeadline}>{title}</span>
                        <span className={styles.slideNumber}>Slide {slide.number}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : <div />}
          <div className={styles.slideColumn}>
            <div className={styles.slideStage}>
              {showSlideImage ? (
                <img src={call.slideUrl} alt={call.slideLabel || "Current slide"} onError={() => setSlideBroken(true)} />
              ) : (
                <div className={styles.slideCard}>
                  <p className={styles.slideKicker}>{call.slideLabel || "Slide"}</p>
                  {call.slideSlogan ? <p className={styles.slideSlogan}>{call.slideSlogan}</p> : null}
                </div>
              )}
            </div>
            {points.length ? (
              <aside className={styles.featurePanel}>
                <p className={styles.slideKicker}>Key features</p>
                <ul>
                  {points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </aside>
            ) : null}
          </div>
          {talkOpen ? (
            <div className={`${styles.callTalk} rounded-3xl border border-edge bg-panel/90 p-3`}>
              <ul className="max-h-full space-y-3 overflow-auto">
                {call.interim ? <li className="text-sm leading-6 text-muted">You, still speaking: {call.interim}</li> : null}
                {presentTranscript(call.captions).map((line) => (
                  <li key={line.id} className="text-sm leading-6 text-bone">
                    <span className="mr-2 font-mono text-[0.65rem] uppercase tracking-wider text-amber">
                      {line.speaker === "agent" ? "Interviewa" : "You"}
                    </span>
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        <footer className={styles.controlBar}>
          <p className={styles.countdown} aria-live="polite">
            {call.remainingSeconds == null ? "" : `${formatCountdown(call.remainingSeconds)} left`}
          </p>
          {call.endAsk ? (
            <div className={styles.endAsk}>
              <p>Are you sure you want to end the call?</p>
              <button type="button" className={styles.endSolid} onClick={call.confirmHangUp}>End call</button>
              <button type="button" className={styles.btnGhost} onClick={call.cancelHangUp}>Keep talking</button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={call.muted ? styles.muteOff : styles.muteOn}
                aria-pressed={call.muted}
                aria-label={call.muted ? "Muted. Unmute microphone" : "Mute microphone"}
                onClick={() => call.setMuted(!call.muted)}
              >
                {call.muted ? "Muted" : "Mute"}
              </button>
              <button type="button" className={styles.endSolid} onClick={call.hangUp}>End conversation</button>
            </>
          )}
        </footer>
      </main>
    );
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-10">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-amber">Private conversation</p>
      </div>
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

      {call.phase === "ended" ? (
        <section className={`${styles.lightCard} mt-8`}>
          <h2 className={styles.cardTitle}>Thank you</h2>
          <p className="mt-2 text-sm leading-6">{call.recap?.summary || "Thanks for the conversation."}</p>
          {call.recap?.topics?.length ? (
            <ul className={styles.dotList}>{call.recap.topics.map((topic) => <li key={topic}>{topic}</li>)}</ul>
          ) : null}
          {call.recap?.nextStep ? <p className="mt-3 text-sm">{call.recap.nextStep}</p> : null}
          <p className={`${styles.note} mt-2`}>
            {call.billableSeconds === null
              ? "The conversation is closed."
              : `Connected time recorded: ${call.billableSeconds} seconds. Waiting time was not included.`}
          </p>
          {bookingNote ? <p className="mt-3 text-sm">{bookingNote}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
