"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";

type Turn = { role: "interviewer" | "candidate"; text: string };
type Mode = "cooperative" | "rambling" | "evasive";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "cooperative", label: "Cooperative", hint: "Clear, focused answers with real examples" },
  { value: "rambling", label: "Rambling", hint: "Wanders, over-explains, slow to the point" },
  { value: "evasive", label: "Evasive", hint: "Dodges the question (triggers REDIRECT)" },
];

export default function CandidateBotPage() {
  const params = useParams();
  const room = Array.isArray(params.room) ? params.room[0] : params.room || "";

  const [mode, setMode] = useState<Mode>("cooperative");
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [cvLoaded, setCvLoaded] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<Turn[]>([]);

  const roomRef = useRef<Room | null>(null);
  const cvContextRef = useRef("");
  const modeRef = useRef<Mode>("cooperative");
  const historyRef = useRef<Turn[]>([]);
  const bufferRef = useRef(""); // accumulates interviewer finals until speechFinal
  const processingRef = useRef(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const speak = useCallback((text: string) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* TTS unavailable - line was still published */
    }
  }, []);

  const publishCandidate = useCallback((text: string) => {
    const r = roomRef.current;
    if (!r) return;
    const payload = new TextEncoder().encode(
      JSON.stringify({
        type: "transcript",
        role: "candidate",
        text,
        speechFinal: true,
      })
    );
    r.localParticipant.publishData(payload, { reliable: true });
  }, []);

  // Generate + speak + publish a candidate reply to the interviewer's question.
  const respond = useCallback(
    async (question: string) => {
      if (processingRef.current) return;
      const q = question.trim();
      if (q.length < 3) return;

      processingRef.current = true;
      setThinking(true);
      setLog((prev) => [...prev, { role: "interviewer", text: q }]);

      try {
        const historyStr = historyRef.current
          .map(
            (t) =>
              `${t.role === "interviewer" ? "Interviewer" : "Candidate"}: ${t.text}`
          )
          .join("\n");

        const res = await fetch("/api/candidate/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            history: historyStr,
            cvContext: cvContextRef.current,
            mode: modeRef.current,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Respond failed");

        const answer = (data.answer || "").trim();
        historyRef.current.push({ role: "interviewer", text: q });
        if (answer) {
          historyRef.current.push({ role: "candidate", text: answer });
          publishCandidate(answer);
          setLog((prev) => [...prev, { role: "candidate", text: answer }]);
          speak(answer);
        }
      } catch (e: any) {
        setLog((prev) => [
          ...prev,
          { role: "candidate", text: `(couldn't reply: ${e.message})` },
        ]);
      } finally {
        processingRef.current = false;
        setThinking(false);
      }
    },
    [publishCandidate, speak]
  );

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

      // Listen for the interviewer's transcript. Accumulate their finals and,
      // when they finish a turn (speechFinal), generate a candidate reply.
      r.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type !== "transcript" || msg.role !== "interviewer") return;
          bufferRef.current = `${bufferRef.current} ${msg.text}`.trim();
          if (msg.speechFinal) {
            const question = bufferRef.current.trim();
            bufferRef.current = "";
            respond(question);
          }
        } catch {
          /* ignore non-JSON frames */
        }
      });

      await r.connect(data.url, data.token);
      // No mic published - the bot communicates via data channel + local TTS.
      setJoined(true);

      // Load the session-scoped CV so the candidate answers in character.
      try {
        const ctxRes = await fetch("/api/interview/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: room }),
        });
        const ctx = await ctxRes.json();
        cvContextRef.current = ctx.context || "";
        setCvLoaded(!!(ctx.context && ctx.context.trim()));
      } catch {
        cvContextRef.current = "";
        setCvLoaded(false);
      }
    } catch (e: any) {
      setError(e.message || "Could not join");
    } finally {
      setConnecting(false);
    }
  }, [room, respond]);

  const leave = useCallback(async () => {
    window.speechSynthesis?.cancel();
    await roomRef.current?.disconnect();
    roomRef.current = null;
    historyRef.current = [];
    bufferRef.current = "";
    setJoined(false);
    setLog([]);
  }, []);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
      roomRef.current?.disconnect();
    },
    []
  );

  const ordered = [...log].reverse();

  return (
    <main className="relative z-10 mx-auto max-w-[760px] px-5 py-10">
      <h1 className="font-display text-[2.2rem] leading-none tracking-tight text-bone">
        Candidate <span className="italic text-amber">bot</span>
      </h1>
      <p className="mt-2 mb-7 font-mono text-xs uppercase tracking-[0.25em] text-muted">
        responsive harness · room {room}
      </p>

      {!joined ? (
        <div className="flex flex-col gap-5 rounded-2xl border border-edge bg-panel/50 p-6">
          <div>
            <span className="mb-2 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
              Behaviour
            </span>
            <div className="flex flex-col gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    mode === m.value
                      ? "border-amber bg-amber/10"
                      : "border-edge hover:border-amber/50"
                  }`}
                >
                  <span
                    className={`block font-mono text-[0.8rem] uppercase tracking-wider ${
                      mode === m.value ? "text-amber" : "text-bone"
                    }`}
                  >
                    {m.label}
                  </span>
                  <span className="font-sans text-xs text-muted">{m.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={join}
            disabled={connecting}
            className="self-start rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
          >
            {connecting ? "joining..." : "Join as candidate bot"}
          </button>
          <p className="font-mono text-[0.7rem] text-muted">
            Answers in character from the CV uploaded for this session. Just talk
            as the interviewer - the bot replies on its own.
          </p>
          {error && <p className="font-mono text-xs text-rust">! {error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5 rounded-2xl border border-edge bg-panel/50 p-6">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-sage">
              joined · listening
            </span>
            <button
              onClick={leave}
              className="rounded-full border border-rust px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
            >
              leave
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`rounded-full border px-3.5 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
                  mode === m.value
                    ? "border-amber bg-amber/15 text-amber"
                    : "border-edge text-muted hover:border-amber/50 hover:text-bone"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 font-mono text-[0.7rem]">
            <span className={cvLoaded ? "text-sage" : "text-muted"}>
              {cvLoaded ? "CV loaded - in character" : "no CV - generic persona"}
            </span>
            {thinking && <span className="thinking text-amber">thinking...</span>}
          </div>

          <div className="flex flex-col gap-2">
            {ordered.length === 0 ? (
              <p className="font-mono text-sm text-muted">
                Waiting for your first question...
              </p>
            ) : (
              ordered.map((t, i) => (
                <div
                  key={i}
                  className={`rounded-xl border px-4 py-3 ${
                    t.role === "candidate"
                      ? "border-sage/40 bg-sage/5"
                      : "border-edge bg-ink/40"
                  }`}
                >
                  <p
                    className={`mb-1 font-mono text-[0.55rem] uppercase tracking-[0.2em] ${
                      t.role === "candidate" ? "text-sage" : "text-amber/70"
                    }`}
                  >
                    {t.role === "candidate" ? "candidate (bot)" : "interviewer"}
                  </p>
                  <p className="font-sans text-sm leading-snug text-bone/90">
                    {t.text}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </main>
  );
}
