"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import VoiceNoteButton from "@/components/VoiceNoteButton";

type Turn = { role: "user" | "coach"; text: string };

// The coach's check-in. It interviews Lee: it asks, he answers, it reads back
// what it understood and drills with a follow-up or two, then he confirms and
// it locks the fact in. Answer by voice or type. The coach speaks its replies.
// Self-hides when there's nothing to ask or you've worked through them.
export default function MorningCheckin() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [convo, setConvo] = useState<Turn[]>([]);
  const [coachReply, setCoachReply] = useState("");
  const [ready, setReady] = useState(false); // coachReply is a read-back to confirm
  const [busy, setBusy] = useState(false);
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
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

  // Speak text in the coach's voice (ElevenLabs, browser fallback).
  const speak = async (text: string) => {
    if (!text) return;
    try {
      audioRef.current?.pause();
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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
          synth.speak(new (window as any).SpeechSynthesisUtterance(text));
        }
      } catch {
        /* ignore */
      }
    }
  };

  const resetForNext = () => {
    setAnswer("");
    setConvo([]);
    setCoachReply("");
    setReady(false);
  };

  const next = () => {
    resetForNext();
    if (idx + 1 >= questions.length) setDone(true);
    else setIdx((i) => i + 1);
  };

  // Send Lee's answer, get the coach's reaction: a follow-up, or a read-back to
  // confirm.
  const sendAnswer = async () => {
    const a = answer.trim();
    if (!a || busy || !current) return;
    const turns: Turn[] = [...convo, { role: "user", text: a }];
    setConvo(turns);
    setAnswer("");
    setBusy(true);
    setCoachReply("");
    try {
      const r = await crmFetch<{ ready?: boolean; reply?: string }>(
        "/api/crm/brain/interview",
        {
          method: "POST",
          body: JSON.stringify({ action: "react", question: current, turns }),
        }
      );
      const reply = (r.reply || "").trim();
      const finalTurns: Turn[] = [...turns, { role: "coach", text: reply }];
      setConvo(finalTurns);
      setCoachReply(reply);
      if (reply) speak(reply);
      if (r.ready) {
        // The coach has what it needs - take the answer as given and save it,
        // no second confirmation. Only a genuine follow-up (ready=false) loops
        // back for another reply.
        await saveTurns(finalTurns);
      }
    } catch {
      // Coach couldn't react - don't trap Lee in a confirm step, just save what
      // he said and move on.
      await saveTurns(turns);
    } finally {
      setBusy(false);
    }
  };

  // Distil and save the whole exchange, then move on. There is no separate
  // confirm step: once Lee has answered (and any real follow-ups are done), his
  // answer IS the answer, so a read-back saves itself.
  const saveTurns = async (turns: Turn[]) => {
    if (!current) return;
    try {
      const r = await crmFetch<{ ack?: string; createdTasks?: any[] }>(
        "/api/crm/brain/interview",
        {
          method: "POST",
          body: JSON.stringify({ action: "save", question: current, turns }),
        }
      );
      if (r.createdTasks && r.createdTasks.length) {
        window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      }
    } catch {
      /* still advance so the flow isn't stuck */
    } finally {
      next();
    }
  };
  const confirmSave = () => saveTurns(convo);

  // "Not quite" - reopen the answer box so Lee can clarify; the coach reacts
  // again to the correction.
  const clarify = () => {
    setReady(false);
    setCoachReply("");
  };

  if (dismissed || questions.length === 0) return null;

  if (done) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-xl border border-sage/40 bg-sage/[0.06] p-3">
        <p className="font-sans text-[0.84rem] text-bone/85">
          {"✓"} Thanks. Your brain just got a lot sharper.
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
          {"☼"} {greeting} check-in{" "}
          <span className="text-muted">
            - your coach ({idx + 1}/{questions.length})
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
          onClick={() => speak(current)}
          title="hear the question"
          className="flex-none rounded-full border border-edge px-2 py-0.5 font-mono text-[0.6rem] text-muted transition hover:border-sky/50 hover:text-sky"
        >
          {"\u{1F50A}"}
        </button>
      </div>

      {/* The coach's reaction: a follow-up question, or a read-back to confirm. */}
      {coachReply && (
        <div
          className={`mb-2 rounded-lg border px-3 py-2 font-sans text-[0.86rem] leading-snug ${
            ready
              ? "border-sage/50 bg-sage/[0.08] text-bone"
              : "border-sky/40 bg-sky/[0.06] text-bone/90"
          }`}
        >
          <span className="mr-1.5 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
            {ready ? "confirm" : "coach"}
          </span>
          {coachReply}
        </div>
      )}

      {ready ? (
        // Read-back confirm: lock it in, or clarify.
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={confirmSave}
            disabled={busy}
            className="rounded-full border border-sage/60 bg-sage/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:opacity-40"
          >
            {busy ? "saving…" : "✓ yes, lock it in"}
          </button>
          <button
            type="button"
            onClick={clarify}
            disabled={busy}
            className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:text-bone disabled:opacity-40"
          >
            not quite, let me clarify
          </button>
          <button
            type="button"
            onClick={next}
            className="ml-auto rounded-full border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:text-bone"
          >
            skip
          </button>
        </div>
      ) : (
        // Answer the question or the coach's follow-up.
        <>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
              {convo.length ? "your reply" : "your answer"}
            </span>
            <span className="ml-auto">
              <VoiceNoteButton
                onText={(t) =>
                  setAnswer((p) => (p.trim() ? `${p.trim()} ${t}` : t))
                }
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
              onClick={sendAnswer}
              disabled={busy || !answer.trim()}
              className="rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
            >
              {busy ? "thinking…" : convo.length ? "reply" : "answer"}
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:text-bone"
            >
              skip
            </button>
          </div>
        </>
      )}
    </div>
  );
}
