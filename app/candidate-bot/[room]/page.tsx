"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "livekit-client";

const DEFAULT_SCRIPT = `I've spent the last six years in sales for EPOS and payment systems, mostly mid-market hospitality clients.
I'm drawn to product management because I kept spotting gaps in what we sold and wanted to shape the roadmap, not just pitch it.
A specific example: I noticed our smaller venues churned because onboarding took two weeks, so I pushed the product team for a self-serve setup flow and it cut churn noticeably.
My biggest weakness is that I sometimes go too deep into detail before stepping back to the bigger picture.
I measure success by adoption and retention, not just launch — a feature nobody uses isn't a win.`;

export default function CandidateBotPage() {
  const params = useParams();
  const room = Array.isArray(params.room) ? params.room[0] : params.room || "";

  const [scriptText, setScriptText] = useState(DEFAULT_SCRIPT);
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [idx, setIdx] = useState(0);

  const roomRef = useRef<Room | null>(null);

  const lines = scriptText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const join = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room,
          identity: "Candidate (bot)",
          role: "candidate",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Token request failed");
      if (!data.url) throw new Error("Missing NEXT_PUBLIC_LIVEKIT_URL in env");

      const r = new Room();
      roomRef.current = r;
      await r.connect(data.url, data.token);
      // No mic published — the bot communicates via data channel + local TTS.
      setJoined(true);
    } catch (e: any) {
      setError(e.message || "Could not join");
    } finally {
      setConnecting(false);
    }
  }, [room]);

  const speakNext = useCallback(() => {
    const r = roomRef.current;
    if (!r || idx >= lines.length) return;
    const line = lines[idx];

    // 1. Publish immediately as the candidate transcript (reliable, deterministic).
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: "transcript",
        role: "candidate",
        text: line,
        speechFinal: true,
      })
    );
    r.localParticipant.publishData(payload, { reliable: true });

    // 2. Speak it aloud (free browser voice) so you can hear & respond.
    try {
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* TTS unavailable — line was still published above */
    }

    setIdx((i) => i + 1);
  }, [idx, lines]);

  const leave = useCallback(async () => {
    window.speechSynthesis?.cancel();
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setJoined(false);
    setIdx(0);
  }, []);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
      roomRef.current?.disconnect();
    },
    []
  );

  const done = idx >= lines.length;

  return (
    <main className="relative z-10 mx-auto max-w-[760px] px-5 py-10">
      <h1 className="font-display text-[2.2rem] leading-none tracking-tight text-bone">
        Candidate <span className="italic text-amber">bot</span>
      </h1>
      <p className="mt-2 mb-7 font-mono text-xs uppercase tracking-[0.25em] text-muted">
        test harness · room {room}
      </p>

      {!joined ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-panel/50 p-6">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
              Script — one candidate answer per line
            </span>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-mono text-sm text-bone outline-none focus:border-amber/60"
            />
          </label>
          <button
            onClick={join}
            disabled={connecting || !lines.length}
            className="self-start rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
          >
            {connecting ? "joining…" : "● Join as candidate bot"}
          </button>
          {error && <p className="font-mono text-xs text-rust">⚠︎ {error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5 rounded-2xl border border-edge bg-panel/50 p-6">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-sage">
              ● joined · line {Math.min(idx + 1, lines.length)} / {lines.length}
            </span>
            <button
              onClick={leave}
              className="rounded-full border border-rust px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
            >
              ■ leave
            </button>
          </div>

          <div className="rounded-xl border border-edge bg-ink/40 px-4 py-4">
            <p className="mb-1 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted">
              {done ? "script finished" : "next line"}
            </p>
            <p className="font-display text-lg leading-snug text-bone">
              {done ? "— end of script —" : lines[idx]}
            </p>
          </div>

          <button
            onClick={speakNext}
            disabled={done}
            className="self-start rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-40"
          >
            ▶ Speak next line
          </button>

          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <p
                key={i}
                className={`font-mono text-xs leading-relaxed ${
                  i < idx
                    ? "text-muted line-through"
                    : i === idx
                    ? "text-amber"
                    : "text-bone/70"
                }`}
              >
                {i + 1}. {l}
              </p>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
