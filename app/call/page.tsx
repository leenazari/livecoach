"use client";

import { useEffect, useState } from "react";
import CallStage from "@/components/CallStage";

export default function CallPage() {
  const [room] = useState(
    () => `lc-${Math.random().toString(36).slice(2, 8)}`
  );
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const joinLink = origin ? `${origin}/join/${room}` : "";

  const copy = async () => {
    if (!joinLink) return;
    await navigator.clipboard.writeText(joinLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="relative z-10 mx-auto max-w-[900px] px-5 py-10">
      <h1 className="font-display text-[2.4rem] leading-none tracking-tight text-bone">
        <span className="italic text-amber">Live</span>Coach · call test
      </h1>
      <p className="mt-2 mb-7 font-mono text-xs uppercase tracking-[0.25em] text-muted">
        stage A · two-party audio
      </p>

      <div className="mb-6 rounded-2xl border border-amber/40 bg-amber/[0.06] p-5">
        <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
          Send this link to the candidate
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="break-all rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-sm text-bone">
            {joinLink || "preparing link…"}
          </code>
          <button
            onClick={copy}
            disabled={!joinLink}
            className="rounded-full border border-amber/50 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/10 disabled:opacity-40"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </div>
        <p className="mt-3 font-mono text-[0.65rem] text-muted">
          To test alone: open this link on your phone (use headphones to avoid
          echo), join here on your laptop.
        </p>
      </div>

      <CallStage room={room} identity="Interviewer" role="interviewer" />
    </main>
  );
}
