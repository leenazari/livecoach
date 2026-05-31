"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CallStage from "@/components/CallStage";

type Line = { role: string; text: string };

export default function CallPage() {
  const [room] = useState(() => `lc-${Math.random().toString(36).slice(2, 8)}`);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const joinLink = origin ? `${origin}/join/${room}` : "";
  const botLink = origin ? `${origin}/candidate-bot/${room}` : "";

  const copy = async () => {
    if (!joinLink) return;
    await navigator.clipboard.writeText(joinLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onFinalTranscript = useCallback((role: string, text: string) => {
    setLines((prev) => [...prev, { role, text }]);
  }, []);

  return (
    <main className="relative z-10 mx-auto max-w-[1100px] px-5 py-10">
      <h1 className="font-display text-[2.4rem] leading-none tracking-tight text-bone">
        <span className="italic text-amber">Live</span>Coach · call test
      </h1>
      <p className="mt-2 mb-7 font-mono text-xs uppercase tracking-[0.25em] text-muted">
        stage B · labelled transcript
      </p>

      <div className="mb-6 grid gap-3 rounded-2xl border border-amber/40 bg-amber/[0.06] p-5">
        <div>
          <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
            Real candidate — send this link
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="break-all rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-sm text-bone">
              {joinLink || "preparing…"}
            </code>
            <button
              onClick={copy}
              disabled={!joinLink}
              className="rounded-full border border-amber/50 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/10 disabled:opacity-40"
            >
              {copied ? "copied ✓" : "copy"}
            </button>
          </div>
        </div>

        <div className="border-t border-edge/50 pt-3">
          <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-sage">
            Test solo — open the candidate bot in a new tab
          </p>
          
            href={botLink || "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-full border border-sage/50 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-sage transition hover:bg-sage/10"
          >
            ↗ open candidate bot (same room)
          </a>
          <p className="mt-2 font-mono text-[0.65rem] text-muted">
            Use headphones so your interviewer mic doesn’t pick up the bot’s voice.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <CallStage
          room={room}
          identity="Interviewer"
          role="interviewer"
          onFinalTranscript={onFinalTranscript}
        />

        <section className="flex min-h-[340px] flex-col rounded-2xl border border-edge bg-panel/50">
          <div className="border-b border-edge px-6 py-3.5">
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
              Labelled transcript
            </h2>
          </div>
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-6 py-5"
          >
            {lines.length === 0 ? (
              <p className="font-mono text-sm text-muted">
                Join, open the bot tab and join it too, then talk / play lines —
                each line is tagged with who said it.
              </p>
            ) : (
              lines.map((l, i) => (
                <p key={i} className="font-mono text-sm leading-relaxed">
                  <span
                    className={
                      l.role === "interviewer"
                        ? "text-amber"
                        : l.role === "candidate"
                        ? "text-sage"
                        : "text-muted"
                    }
                  >
                    {l.role === "interviewer"
                      ? "Interviewer"
                      : l.role === "candidate"
                      ? "Candidate"
                      : l.role}
                    :
                  </span>{" "}
                  <span className="text-bone/90">{l.text}</span>
                </p>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
