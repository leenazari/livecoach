"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import VoiceNoteButton from "@/components/VoiceNoteButton";

// Morning check-in: the brain interviews you with a few questions it wants
// answered to know you better and brainstorm your to-dos. Answer by voice or
// type. Each answer is folded into the brain's learned layer and can spin out
// to-dos. Self-hides when there's nothing to ask or you've worked through them.
export default function MorningCheckin() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState("");
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answerElRef = useRef<HTMLTextAreaElement | null>(null);
  const sizeAnswer = () => {
    const el = answerElRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
    el.scrollTop = el.scrollHeight;
  };
  useEffect(() => {
    sizeAnswer();
  }, [answer]);

  useEffect(() => {
    crmFetch<{ questions: string[] }>("/api/crm/brain/interview")
      .then((d) => setQuestions(Array.isArray(d.questions) ? d.questions : []))
      .catch(() => {});
    return () => {
      try {
        audioRef.current?.pause();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const current = questions[idx];

  const next = () => {
    setAnswer("");
    if (idx + 1 >= questions.length) setDone(true);
    else setIdx((i) => i + 1);
  };

  const submit = async () => {
    const a = answer.trim();
    if (!a || busy || !current) return;
    setBusy(true);
    try {
      const r = await crmFetch<{ ok: boolean; ack?: string; createdTasks?: any[] }>(
        "/api/crm/brain/interview",
        {
          method: "POST",
          body: JSON.stringify({ question: current, answer: a }),
        }
      );
      if (r.ack) {
        setAck(r.ack);
        setTimeout(() => setAck(""), 2600);
      }
      if (r.createdTasks && r.createdTasks.length) {
        window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      }
    } catch {
      /* ignore - still advance so the flow isn't stuck */
    } finally {
      setBusy(false);
      next();
    }
  };

  // Tap to hear the question in the brain's voice (ElevenLabs, browser fallback).
  const hear = async () => {
    if (!current) return;
    try {
      audioRef.current?.pause();
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: current }),
      });
      if (!res.ok) throw new Error("tts");
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      try {
        const synth = (window as any).speechSynthesis;
        if (synth) {
          synth.cancel();
          synth.speak(new (window as any).SpeechSynthesisUtterance(current));
        }
      } catch {
        /* ignore */
      }
    }
  };

  if (dismissed || questions.length === 0) return null;

  if (done) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-xl border border-sage/40 bg-sage/[0.06] p-3">
        <p className="font-sans text-[0.84rem] text-bone/85">
          {"✓"} Thanks. Your brain just got a little sharper.
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-bone"
        >
          close
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-amber/40 bg-amber/[0.06] p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"☼"} Morning check-in{" "}
          <span className="text-muted">
            - help your brain ({idx + 1}/{questions.length})
          </span>
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          title="not now"
          className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-bone"
        >
          not now
        </button>
      </div>

      <div className="mb-2 flex items-start gap-2">
        <p className="flex-1 font-sans text-[0.95rem] leading-snug text-bone">
          {current}
        </p>
        <button
          type="button"
          onClick={hear}
          title="hear the question"
          className="flex-none rounded-full border border-edge px-2 py-0.5 font-mono text-[0.6rem] text-muted transition hover:border-sky/50 hover:text-sky"
        >
          {"\u{1F50A}"}
        </button>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
          your answer
        </span>
        <span className="ml-auto">
          <VoiceNoteButton
            onText={(t) => setAnswer((p) => (p.trim() ? `${p.trim()} ${t}` : t))}
          />
        </span>
      </div>
      <textarea
        ref={answerElRef}
        value={answer}
        onChange={(e) => {
          setAnswer(e.target.value);
          sizeAnswer();
        }}
        rows={3}
        placeholder="Tap the mic and talk, or type your answer."
        className="max-h-[160px] min-h-[64px] w-full resize-none overflow-y-auto rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-[0.86rem] leading-relaxed text-bone outline-none placeholder:text-muted/50 focus:border-amber/60"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !answer.trim()}
          className="rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
        >
          {busy ? "saving…" : "answer & next"}
        </button>
        <button
          type="button"
          onClick={next}
          className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:text-bone"
        >
          skip
        </button>
        {ack && (
          <span className="ml-auto font-mono text-[0.58rem] text-sage">
            {ack}
          </span>
        )}
      </div>
    </div>
  );
}
