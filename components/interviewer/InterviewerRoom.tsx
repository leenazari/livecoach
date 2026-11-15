"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import styles from "@/components/interviewer/interviewa.module.css";
import { formatCountdown } from "@/lib/interviewer/call-limit";
import { presentTranscript } from "@/lib/interviewer/transcript-display";
import { INTERVIEWER_MIC_CONSTRAINTS } from "@/lib/interviewer/listen-url";
import { micStartPlan, type MicStartPlan } from "@/lib/interviewer/mic-start";
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

function MuteMark({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 14.2a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 0 0-6.4 0v4.8a3.2 3.2 0 0 0 3.2 3.2Zm5.2-3.2a5.2 5.2 0 0 1-4.2 5.1V19h2.2v2h-6.4v-2H11v-2.9a5.2 5.2 0 0 1-4.2-5.1H9a3.2 3.2 0 0 0 6.4 0h1.8Z"
      />
      {muted ? <path d="M5 4.2 19.8 19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /> : null}
    </svg>
  );
}

function whenLabel(when: string | null): string {
  if (!when) return "";
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function CallSummary({
  recap,
  bookedWhen,
}: {
  recap: Recap;
  bookedWhen: string | null;
}) {
  const booked = Boolean(recap?.booked || bookedWhen);
  const when = bookedWhen || recap?.when || null;
  const picture = [recap?.businessType, recap?.howTheyServe].filter((item) => item && !/not established/i.test(item)).join(" ");
  return (
    <section className={`${styles.lightCard} mt-8`}>
      <h2 className={styles.cardTitle}>Thanks for talking with us</h2>
      <p className="mt-2 text-sm leading-6">{picture || recap?.summary || "Thanks for the conversation. We will be in touch."}</p>
      {booked ? <p className={`${styles.note} mt-3`}>A time is already held{whenLabel(when) ? `: ${whenLabel(when)}` : ""}.</p> : null}
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
  bookingUrl = "",
}: {
  token: string;
  campaignName: string;
  capMinutes?: string;
  bookingUrl?: string;
}) {
  const call = useInterviewerCall(token, capMinutes);
  const [micPlan, setMicPlan] = useState<MicStartPlan | "checking">("checking");
  const [micError, setMicError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const micStarted = useRef(false);
  const [slideRatio, setSlideRatio] = useState({ w: 16, h: 9 });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookedWhen, setBookedWhen] = useState<string | null>(null);
  const [bookingSaved, setBookingSaved] = useState<boolean | null>(null);
  const [slideBroken, setSlideBroken] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const slideStageRef = useRef<HTMLDivElement | null>(null);
  const callScreenRef = useRef<HTMLElement | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [portrait, setPortrait] = useState(true);

  const calendarUrl = bookingUrl || call.bookingUrl;
  useLayoutEffect(() => {
    if (call.phase !== "ended" || !calendarUrl) return;
    window.location.replace(calendarUrl);
  }, [call.phase, calendarUrl]);

  const showSlideImage = Boolean(call.slideUrl) && !slideBroken;
  const noteRatio = (image: HTMLImageElement) => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setSlideRatio({ w: image.naturalWidth, h: image.naturalHeight });
    }
  };

  useEffect(() => {
    setSlideBroken(false);
  }, [call.slideUrl]);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem("interviewer-turn-hint") === "off") setHintDismissed(true);
    } catch { /* the hint can still be dismissed */ }
    const query = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const dismissHint = () => {
    setHintDismissed(true);
    try { window.sessionStorage.setItem("interviewer-turn-hint", "off"); } catch { /* the hint stays hidden this view */ }
  };

  const toggleFullscreen = async () => {
    const node = callScreenRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        try { screen.orientation.unlock(); } catch { /* iOS Safari has no lock */ }
        return;
      }
      await node.requestFullscreen();
      try {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
        await orientation.lock?.("landscape");
      } catch { /* iOS Safari cannot lock orientation */ }
    } catch { /* this browser does not offer fullscreen */ }
  };

  const startCall = async () => {
    if (micStarted.current || call.phase !== "mic") return;
    micStarted.current = true;
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: INTERVIEWER_MIC_CONSTRAINTS });
      streamRef.current = stream;
      await call.join(stream);
    } catch {
      micStarted.current = false;
      try { window.sessionStorage.removeItem("interviewer-mic"); } catch { /* the message still shows */ }
      setMicPlan("blocked");
      setMicError("The microphone is blocked. Allow it in the browser, then start the call.");
    }
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const startRef = useRef(startCall);
  startRef.current = startCall;

  useEffect(() => {
    if (call.phase !== "mic") return undefined;
    let cancel = false;
    const look = async () => {
      let permission: "granted" | "denied" | "prompt" | "unknown" = "unknown";
      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (status.state === "granted" || status.state === "denied" || status.state === "prompt") permission = status.state;
      } catch { /* some browsers do not report microphone permission */ }
      if (permission === "unknown") {
        try {
          if (window.sessionStorage.getItem("interviewer-mic") === "granted") permission = "granted";
        } catch { /* keep the start button */ }
      }
      if (cancel) return;
      const plan = micStartPlan(permission);
      setMicPlan(plan);
      if (plan === "blocked") {
        setMicError("The microphone is blocked. Allow it in the browser, then start the call.");
        return;
      }
      if (plan === "auto") void startRef.current();
    };
    void look();
    return () => { cancel = true; };
  }, [call.phase]);

  const suggest = async () => {
    if (!call.sessionId) return;
    const data = await postJson<{ slots?: Slot[]; note?: string }>("/api/interviewer/book", {
      token,
      sessionId: call.sessionId,
      action: "suggest",
    });
    setSlots(data.slots || []);
  };

  useEffect(() => {
    if (call.phase !== "ended" || !call.sessionId || call.recap?.booked || bookedWhen || bookingUrl || call.bookingUrl) return;
    void suggest();
  }, [bookedWhen, bookingUrl, call.bookingUrl, call.phase, call.recap?.booked, call.sessionId]);

  const book = async (slot: Slot) => {
    if (!call.sessionId || bookingSaved === false) return;
    const data = await postJson<{ booked?: boolean; saved?: boolean; note?: string; scheduledAt?: string }>("/api/interviewer/book", {
      token,
      sessionId: call.sessionId,
      action: "book",
      start: slot.start,
      end: slot.end,
    });
    setBookingSaved(data.saved !== false && data.booked === true);
    if (data.booked) {
      setBookedWhen(data.scheduledAt || slot.start);
      setSlots([]);
    }
  };

  if (call.phase === "live" || call.connecting || call.phase === "waiting") {
    const points = (call.slideIndex.find((item) => item.number === call.slideNumber)?.points || []).slice(0, 5);
    return (
      <main ref={callScreenRef} className={styles.callScreen} style={{ "--slide-w": String(slideRatio.w), "--slide-h": String(slideRatio.h) } as CSSProperties}>
        <header className={styles.callTop}>
          <p>{campaignName}</p>
          <button type="button" className={styles.fullScreenBtn} onClick={() => void toggleFullscreen()}>Full screen</button>
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
                      {slide.url ? <img src={slide.url} alt="" className={styles.slideThumb} onLoad={(event) => noteRatio(event.currentTarget)} /> : <span className={styles.slideThumb} aria-hidden="true" />}
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
            <div className={styles.slideStage} ref={slideStageRef}>
              {call.phase === "live" && call.remainingSeconds != null && call.remainingSeconds <= 120 ? (
                <p className={styles.limitClock} role="timer" aria-live="assertive" aria-label={`${formatCountdown(call.remainingSeconds)} left on this call`} onClick={(event) => event.stopPropagation()}>
                  {formatCountdown(call.remainingSeconds)}
                </p>
              ) : null}
              {showSlideImage ? (
                <img src={call.slideUrl} alt={call.slideLabel || "Current slide"} onLoad={(event) => noteRatio(event.currentTarget)} onError={() => setSlideBroken(true)} />
              ) : (
                <div className={styles.slideCard}>
                  <p className={styles.slideKicker}>{call.slideLabel || "Slide"}</p>
                  {call.slideSlogan ? <p className={styles.slideSlogan}>{call.slideSlogan}</p> : null}
                </div>
              )}
              {portrait && slideRatio.w > slideRatio.h && !hintDismissed ? (
                <button type="button" className={styles.turnHint} onClick={dismissHint}>Turn your phone sideways for the best view</button>
              ) : null}
              {call.phase !== "live" && !call.voiceLive ? <p className={styles.startingCall}>Starting your call…</p> : null}
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
        {call.phase === "waiting" && call.overTenMinutes ? (
          <div className={styles.captionStrip}>
            <p>You can book a time with one of our human team.</p>
            <button type="button" className={styles.expandBtn} onClick={() => void suggest()}>Book a time</button>
            {slots.map((slot) => (
              <button key={slot.start} type="button" className={styles.expandBtn} onClick={() => void book(slot)} disabled={bookingSaved === false}>{slot.label}</button>
            ))}
            <button type="button" className={styles.expandBtn} onClick={() => void call.leaveQueue()}>Leave</button>
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
              <MuteMark muted={call.muted} />
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

  if (call.phase === "ended" && calendarUrl) return null;

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-10">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-amber">{campaignName}</p>
      </div>
      <h1 className="mt-3 font-display text-4xl text-bone">{campaignName}</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Ask anything, or tap a slide to jump to it.</p>

      {call.phase === "mic" && !call.connecting ? (
        <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-6">
          {micPlan === "auto" || micPlan === "checking" ? (
            <h2 className="font-display text-2xl text-bone">Starting the call</h2>
          ) : (
            <>
              <h2 className="font-display text-2xl text-bone">Start the call</h2>
              {micError ? <p className="mt-3 text-sm text-rust">{micError}</p> : (
                <p className="mt-2 text-sm leading-6 text-muted">The microphone is requested when you start. If it is already allowed, the call begins on its own.</p>
              )}
              <button type="button" className="mt-5 rounded-full bg-amber px-4 py-2 text-sm text-ink" onClick={() => void startCall()}>
                Start call
              </button>
            </>
          )}
          {call.calmMessage ? <p className="mt-3 text-sm text-bone">{call.calmMessage}</p> : null}
        </section>
      ) : null}

      {call.phase === "ended" && !(bookingUrl || call.bookingUrl) ? (
        <CallSummary recap={call.recap} bookedWhen={bookedWhen} />
      ) : null}
    </main>
  );
}
