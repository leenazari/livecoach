"use client";

import { useEffect, useRef, useState } from "react";

import styles from "@/components/interviewer/interviewa.module.css";
import { formatCountdown } from "@/lib/interviewer/call-limit";
import { presentTranscript } from "@/lib/interviewer/transcript-display";
import { INTERVIEWER_MIC_CONSTRAINTS } from "@/lib/interviewer/listen-url";
import { useInterviewerCall } from "@/components/interviewer/useInterviewerCall";

type Slot = { start: string; end: string; label: string };
type Recap = {
  summary: string;
  businessType: string;
  howTheyServe: string;
  fits: Array<{ title: string; why: string; slideNumber: number | null; slideTitle: string }>;
  answers: Array<{ question: string; answer: string }>;
  booked: boolean;
  when: string | null;
  nextStep: string;
} | null;

function calendarStamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function saveCalendar(when: string) {
  const start = new Date(when);
  if (Number.isNaN(start.getTime())) return;
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Interviewa//Call//EN",
    "BEGIN:VEVENT",
    `DTSTAMP:${calendarStamp(new Date())}`,
    `DTSTART:${calendarStamp(start)}`,
    `DTEND:${calendarStamp(end)}`,
    "SUMMARY:Call with one of our human team",
    "DESCRIPTION:A call with one of our human team. They can walk you through the real system and get you set up with a trial.",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "human-team-call.ics";
  link.click();
  URL.revokeObjectURL(url);
}

function whenLabel(when: string | null): string {
  if (!when) return "";
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function CallSummary({
  recap,
  slides,
  bookedWhen,
  slots,
  note,
  onBook,
}: {
  recap: Recap;
  slides: Array<{ number: number; title: string; url?: string | null }>;
  bookedWhen: string | null;
  slots: Slot[];
  note: string;
  onBook: (slot: Slot) => void;
}) {
  const booked = Boolean(recap?.booked || bookedWhen);
  const when = bookedWhen || recap?.when || null;
  const picture = [recap?.businessType, recap?.howTheyServe].filter((item) => item && !/not established/i.test(item)).join(" ");
  return (
    <section className={`${styles.lightCard} mt-8`}>
      <h2 className={styles.cardTitle}>Thanks for talking with us</h2>
      <p className="mt-2 text-sm leading-6">{picture || recap?.summary || "Thanks for the conversation."}</p>
      {(recap?.fits || []).length ? (
        <div className="mt-4">
          <p className={styles.label}>What fits your setup</p>
          {(recap?.fits || []).map((fit) => {
            const slide = slides.find((item) => item.number === fit.slideNumber);
            return (
              <div key={`${fit.title}-${fit.why}`} className={styles.fitRow}>
                {slide?.url ? <img src={slide.url} alt="" className={styles.slideThumb} /> : <span className={styles.slideThumb} aria-hidden="true" />}
                <div>
                  <p>{fit.slideTitle || fit.title}</p>
                  <p className={styles.note}>{fit.why}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {(recap?.answers || []).length ? (
        <div className="mt-4">
          <p className={styles.label}>Your questions</p>
          {(recap?.answers || []).map((item) => (
            <p key={item.question} className="mt-2 text-sm leading-6"><strong>{item.question}</strong> {item.answer}</p>
          ))}
        </div>
      ) : null}
      {booked ? (
        <div className={`${styles.ready} mt-4`}>
          <p className={styles.readyTitle}>You're booked</p>
          <p className="mt-2">{whenLabel(when) || "The time is on the calendar."}</p>
          <p className={styles.note}>With one of our human team.</p>
          {when ? <button type="button" className={`${styles.btn} mt-3`} onClick={() => saveCalendar(when)}>Add to calendar</button> : null}
        </div>
      ) : (
        <div className="mt-4">
          <p className={styles.label}>Pick a time with one of our human team</p>
          {slots.length ? (
            <ul className="mt-2 space-y-2">
              {slots.map((slot) => (
                <li key={slot.start}>
                  <button type="button" className={styles.btnGhost} onClick={() => onBook(slot)}>{slot.label}</button>
                </li>
              ))}
            </ul>
          ) : <p className={styles.note}>{note || "Checking the calendar for open times."}</p>}
        </div>
      )}
    </section>
  );
}

function recentSentences(lines: Array<{ speaker: string; text: string }>) {
  const sentences: Array<{ speaker: string; text: string }> = [];
  for (const line of lines) {
    const parts = line.text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    const usable = parts.length ? parts : (line.text.trim() ? [line.text.trim()] : []);
    for (const text of usable) sentences.push({ speaker: line.speaker, text });
  }
  return sentences.slice(-2);
}

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
  capMinutes = "",
}: {
  token: string;
  campaignName: string;
  capMinutes?: string;
}) {
  const call = useInterviewerCall(token, capMinutes);
  const [micReady, setMicReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const holdRef = useRef<HTMLAudioElement | null>(null);
  const [holdSrc, setHoldSrc] = useState("/interviewer/hold-loop.wav");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookedWhen, setBookedWhen] = useState<string | null>(null);
  const [bookingNote, setBookingNote] = useState("");
  const [bookingSaved, setBookingSaved] = useState<boolean | null>(null);
  const [slideBroken, setSlideBroken] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const slideStageRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (call.phase !== "ended" || !call.sessionId || call.recap?.booked || bookedWhen) return;
    void suggest();
  }, [bookedWhen, call.phase, call.recap?.booked, call.sessionId]);

  const book = async (slot: Slot) => {
    if (!call.sessionId || bookingSaved === false) return;
    const data = await postJson<{ booked?: boolean; saved?: boolean; note?: string; scheduledAt?: string }>("/api/interviewer/book", {
      token,
      sessionId: call.sessionId,
      action: "book",
      start: slot.start,
      end: slot.end,
    });
    setBookingNote(data.note || "");
    setBookingSaved(data.saved !== false && data.booked === true);
    if (data.booked) {
      setBookedWhen(data.scheduledAt || slot.start);
      setSlots([]);
    }
  };

  if (call.phase === "live") {
    const points = (call.slideIndex.find((item) => item.number === call.slideNumber)?.points || []).slice(0, 5);
    return (
      <main className={styles.callScreen}>
        <header className={styles.callTop}>
          <p>Private conversation · {campaignName}</p>
        </header>
        <section className={`${styles.callStage} ${featuresOpen ? styles.featuresOpen : ""}`}>
          {call.slideIndex.length ? (
            <ol className={styles.slideList}>
              {call.slideIndex.map((slide) => {
                const title = slide.title || "Untitled";
                const active = slide.number === call.slideNumber;
                const seen = !active && call.seenSlides.includes(slide.number);
                return (
                  <li key={slide.number}>
                    <button
                      type="button"
                      className={`${styles.slideRow} ${active ? styles.slideRowActive : ""} ${seen ? styles.slideRowSeen : ""}`}
                      title={title}
                      onClick={() => call.chooseSlide(slide)}
                    >
                      {slide.url ? <img src={slide.url} alt="" className={styles.slideThumb} /> : <span className={styles.slideThumb} aria-hidden="true" />}
                      <span className={styles.slideCopy}>
                        <span className={styles.slideHeadline}>{title}</span>
                        <span className={styles.slideNumber}>Slide {slide.number}</span>
                      </span>
                      {seen ? <span className={styles.seenTick} aria-label="Seen">✓</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : <div className={styles.slideList} />}
          <div className={styles.slideColumn}>
            <div
              className={styles.slideStage}
              ref={slideStageRef}
              onClick={() => {
                const node = slideStageRef.current;
                if (!node) return;
                if (document.fullscreenElement === node) void document.exitFullscreen();
                else void node.requestFullscreen?.();
              }}
            >
              {call.phase === "live" && call.remainingSeconds != null && call.remainingSeconds <= 120 ? (
                <p className={styles.limitClock} role="timer" aria-live="assertive" aria-label={`${formatCountdown(call.remainingSeconds)} left on this call`} onClick={(event) => event.stopPropagation()}>
                  {formatCountdown(call.remainingSeconds)}
                </p>
              ) : null}
              {showSlideImage ? (
                <img src={call.slideUrl} alt={call.slideLabel || "Current slide"} onError={() => setSlideBroken(true)} />
              ) : (
                <div className={styles.slideCard}>
                  <p className={styles.slideKicker}>{call.slideLabel || "Slide"}</p>
                  {call.slideSlogan ? <p className={styles.slideSlogan}>{call.slideSlogan}</p> : null}
                </div>
              )}
            </div>
          </div>
          <aside className={styles.featurePanel}>
            <p className={styles.slideKicker}>Key features</p>
            {points.length ? (
              <ul>
                {points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            ) : <p className={styles.note}>Key points appear with the slide.</p>}
          </aside>
          <div className={styles.captionStrip}>
            <div className={styles.captionLines}>
              {recentSentences(presentTranscript(call.captions)).map((line, index) => (
                <p key={`${line.speaker}-${index}`}>{line.speaker === "agent" ? "Interviewa" : "You"}: {line.text}</p>
              ))}
              {call.interim ? <p>You: {call.interim}</p> : null}
            </div>
            <button type="button" className={styles.featuresToggle} aria-pressed={featuresOpen} onClick={() => setFeaturesOpen((open) => !open)}>
              {featuresOpen ? "Hide points" : "Key points"}
            </button>
            <button type="button" className={styles.expandBtn} onClick={() => setTalkOpen(true)}>Expand</button>
          </div>
        </section>
        {talkOpen ? (
          <div className={styles.transcriptDrawer} role="dialog" aria-label="Full transcript">
            <div className={styles.transcriptPanel}>
              <button type="button" className={styles.expandBtn} onClick={() => setTalkOpen(false)}>Close</button>
              <ul>
                {presentTranscript(call.captions).map((line) => (
                  <li key={line.id}>
                    <span>{line.speaker === "agent" ? "Interviewa" : "You"}</span>
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        <footer className={styles.controlBar}>
          <div className={styles.barLeft}>
            <p className={styles.countdown} aria-live="polite">
              {call.remainingSeconds == null ? "" : `${formatCountdown(call.remainingSeconds)} left`}
            </p>
            <button
              type="button"
              className={call.muted ? styles.muteOff : styles.muteOn}
              aria-pressed={call.muted}
              aria-label={call.muted ? "Muted. Unmute microphone" : "Mute microphone"}
              onClick={() => call.setMuted(!call.muted)}
            >
              {call.muted ? "Muted" : "Mute"}
            </button>
          </div>
          {call.ending ? (
            <button type="button" className={styles.endSolid} onClick={call.hangUp} aria-busy="true">Ending…</button>
          ) : (
            <button type="button" className={styles.endSolid} aria-label="End the conversation" onClick={call.hangUp}>End</button>
          )}
        </footer>
        {call.endAsk ? (
          <div className={styles.endSheet} role="dialog" aria-modal="true" aria-label="End the call">
            <div className={styles.endSheetCard}>
              <p>Are you sure you want to end the call?</p>
              <div className={styles.endSheetActions}>
                <button type="button" className={styles.endSolid} onClick={call.confirmHangUp}>End call</button>
                <button type="button" className={styles.btnGhost} onClick={call.cancelHangUp}>Keep talking</button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-10">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-amber">Private conversation</p>
      </div>
      <h1 className="mt-3 font-display text-4xl text-bone">{campaignName}</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Ask anything, or tap a slide to jump to it.</p>

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
          <p className="mt-2 text-sm text-muted">We'll connect you shortly.</p>
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
              <p className="text-sm text-bone">You can book a time with one of our human team.</p>
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
            Leave
          </button>
        </section>
      ) : null}

      {call.phase === "ended" ? (
        <CallSummary
          recap={call.recap}
          slides={call.slideIndex}
          bookedWhen={bookedWhen}
          slots={slots}
          note={bookingNote}
          onBook={(slot) => void book(slot)}
        />
      ) : null}
    </main>
  );
}
