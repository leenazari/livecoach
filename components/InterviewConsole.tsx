"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import KnowledgePanel from "./KnowledgePanel";
import {
  estimateCost,
  HOURLY_CEILING_GBP,
  type CostBreakdown,
} from "@/lib/costs";

type Suggestion = {
  id: number;
  text: string;
  at: string;
  pending: boolean;
  kind?: "opening" | "live";
};

const SUGGEST_INTERVAL_MS = 5000;
const MIN_NEW_WORDS = 25;

export default function InterviewConsole() {
  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState("");
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [setupOpen, setSetupOpen] = useState(true);
  const [cost, setCost] = useState<CostBreakdown | null>(null);
  const [contextNote, setContextNote] = useState("");
  const [prepping, setPrepping] = useState(false);
  const [docsReady, setDocsReady] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef("");
  const knowledgeRef = useRef("");
  const suggestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lastFiredWordsRef = useRef(0);
  const lastShownRef = useRef("");
  const recentTextsRef = useRef<string[]>([]);

  const startedAtRef = useRef(0);
  const claudeCallsRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suggestTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // auto-fire control
  const autoFiredKeyRef = useRef("");
  const autoFireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, interim]);

  function normalise(s: string) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
  }
  function countWords(s: string) {
    const t = s.trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function isDuplicate(text: string) {
    const n = normalise(text);
    if (!n) return true;
    const last = normalise(lastShownRef.current);
    if (last && (n === last || n.includes(last) || last.includes(n))) return true;
    return false;
  }

  const loadContext = useCallback(async () => {
    const ctxRes = await fetch("/api/interview/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate: candidate || null }),
    });
    const ctx = await ctxRes.json();
    knowledgeRef.current = ctx.context || "";
    setContextNote(
      ctx.chunkCount
        ? `loaded ${ctx.chunkCount} chunk${ctx.chunkCount === 1 ? "" : "s"}`
        : "no docs found"
    );
    return knowledgeRef.current;
  }, [candidate]);

  const generateOpening = useCallback(async () => {
    const res = await fetch("/api/interview/opening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        knowledgeContext: knowledgeRef.current,
        role: role || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to prep questions");

    const qs: string[] = Array.isArray(data.questions) ? data.questions : [];
    claudeCallsRef.current += 1;

    const cards: Suggestion[] = qs.map((q) => ({
      id: ++suggestIdRef.current,
      text: q,
      at: timeNow(),
      pending: false,
      kind: "opening" as const,
    }));
    setSuggestions((prev) => [...cards.reverse(), ...prev]);
    recentTextsRef.current = [...qs, ...recentTextsRef.current].slice(0, 6);
    if (qs.length) lastShownRef.current = qs[qs.length - 1];
  }, [role]);

  const prepOpening = useCallback(async () => {
    setPrepping(true);
    setStatus("prepping questions…");
    try {
      await loadContext();
      await generateOpening();
      setStatus("questions ready");
    } catch (e: any) {
      const msg = e.message || "";
      // Calm, non-scary handling of the "not ready yet" case.
      if (/cv|role|upload/i.test(msg)) {
        setStatus("waiting for a CV + role…");
      } else {
        setStatus(`error: ${msg}`);
      }
    } finally {
      setPrepping(false);
    }
  }, [loadContext, generateOpening]);

  // Auto-fire opening questions once a CV is uploaded AND a role is set —
  // in either order. Debounced so typing the role doesn't spam calls.
  useEffect(() => {
    if (recording) return;
    if (!docsReady) return;
    if (!role.trim()) return;
    const key = `${candidate}|${role}`;
    if (autoFiredKeyRef.current === key) return;

    if (autoFireTimerRef.current) clearTimeout(autoFireTimerRef.current);
    autoFireTimerRef.current = setTimeout(() => {
      autoFiredKeyRef.current = key;
      prepOpening();
    }, 900);

    return () => {
      if (autoFireTimerRef.current) clearTimeout(autoFireTimerRef.current);
    };
  }, [candidate, role, docsReady, recording, prepOpening]);

  const handleUploaded = useCallback(
    (detectedName: string | null, docType: string) => {
      if (detectedName) setCandidate(detectedName);
      setDocsReady(true);
      setStatus(
        docType === "cv" && detectedName
          ? `CV loaded · ${detectedName}`
          : "doc loaded"
      );
    },
    []
  );

  const requestSuggestion = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = opts?.force === true;
      if (inFlightRef.current) return;
      const full = transcriptRef.current.trim();
      if (full.length < 12) return;

      lastFiredWordsRef.current = countWords(full);
      inFlightRef.current = true;
      claudeCallsRef.current += 1;

      const recentWindow = full.slice(-1000);
      const latest = full.slice(-350);
      const id = ++suggestIdRef.current;

      setSuggestions((prev) => [
        { id, text: "", at: timeNow(), pending: true, kind: "live" },
        ...prev,
      ]);

      try {
        const res = await fetch("/api/interview/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            knowledgeContext: knowledgeRef.current,
            recentWindow,
            latest,
            role: role || null,
            previousSuggestions: recentTextsRef.current.slice(0, 3),
            allowHold: !force,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error((await res.text()) || "Suggestion failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setSuggestions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, text: acc } : s))
          );
        }

        const finalText = acc.trim();
        const isHold = finalText.toUpperCase() === "HOLD";
        const drop = isHold || (!force && isDuplicate(finalText));

        if (drop) {
          setSuggestions((prev) => prev.filter((s) => s.id !== id));
        } else {
          lastShownRef.current = finalText;
          recentTextsRef.current = [finalText, ...recentTextsRef.current].slice(0, 6);
          setSuggestions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, pending: false } : s))
          );
        }
      } catch (e: any) {
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, text: `⚠︎ ${e.message}`, pending: false } : s
          )
        );
      } finally {
        inFlightRef.current = false;
      }
    },
    [role]
  );

  const start = useCallback(async () => {
    try {
      setStatus("loading knowledge…");
      await loadContext();

      setStatus("prepping opening questions…");
      try {
        // Only seed if we haven't already auto-prepped this combo.
        if (autoFiredKeyRef.current !== `${candidate}|${role}`) {
          await generateOpening();
        }
      } catch {
        /* non-fatal */
      }

      setStatus("getting microphone…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      setStatus("connecting…");
      const key = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
      if (!key) throw new Error("Missing NEXT_PUBLIC_DEEPGRAM_API_KEY");

      const params = new URLSearchParams({
        model: "nova-2",
        smart_format: "true",
        punctuate: "true",
        interim_results: "true",
        endpointing: "300",
        language: "en",
      });

      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params.toString()}`,
        ["token", key]
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("listening");
        setRecording(true);
        setSetupOpen(false);
        startedAtRef.current = Date.now();
        lastFiredWordsRef.current = 0;

        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };
        recorder.start(250);

        suggestTimerRef.current = setInterval(() => {
          const words = countWords(transcriptRef.current);
          if (words - lastFiredWordsRef.current < MIN_NEW_WORDS) return;
          requestSuggestion();
        }, SUGGEST_INTERVAL_MS);

        tickRef.current = setInterval(() => {
          const elapsed = (Date.now() - startedAtRef.current) / 1000;
          setCost(estimateCost(elapsed, claudeCallsRef.current));
        }, 1000);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const alt = data?.channel?.alternatives?.[0];
          const text: string = alt?.transcript || "";
          if (!text) return;
          if (data.is_final) {
            setTranscript((prev) => (prev ? prev + " " + text : text));
            setInterim("");
          } else {
            setInterim(text);
          }
        } catch {
          /* ignore keepalive frames */
        }
      };

      ws.onerror = (e) => {
        console.error("WebSocket error:", e);
        setStatus("connection error");
      };
      ws.onclose = (e) => {
        console.log("WebSocket closed:", e.code, e.reason);
        stopTimers();
      };
    } catch (e: any) {
      setStatus(`error: ${e.message}`);
      setRecording(false);
    }
  }, [candidate, role, loadContext, generateOpening, requestSuggestion]);

  const stopTimers = useCallback(() => {
    if (suggestTimerRef.current) clearInterval(suggestTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    suggestTimerRef.current = null;
    tickRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
      wsRef.current.close();
    }
    if (startedAtRef.current) {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setCost(estimateCost(elapsed, claudeCallsRef.current));
    }
    setRecording(false);
    setStatus("stopped");
  }, [stopTimers]);

  useEffect(() => () => stop(), [stop]);

  const overBudget =
    !!cost && projectHourly(cost.totalGBP) > HOURLY_CEILING_GBP;

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-7 md:px-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-edge pb-5">
        <div>
          <h1 className="font-display text-[2.6rem] leading-none tracking-tight text-bone">
            <span className="italic text-amber">Live</span>Coach
          </h1>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.25em] text-muted">
            live suggestions · word-gated · haiku tier
          </p>
        </div>

        <div className="flex items-center gap-3">
          <CostMeter cost={cost} overBudget={overBudget} />
          <StatusPill recording={recording} status={status} />
          {!recording ? (
            <button
              onClick={() => start()}
              className="rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow"
            >
              ● Start session
            </button>
          ) : (
            <button
              onClick={stop}
              className="rounded-full border border-rust px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
            >
              ■ End session
            </button>
          )}
        </div>
      </header>

      {setupOpen && (
        <div className="fade-up mb-7 grid gap-4 rounded-2xl border border-edge bg-panel/60 p-5 md:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <Field
            label="Candidate (auto-filled from CV)"
            placeholder="upload a CV to fill this"
            value={candidate}
            onChange={setCandidate}
          />
          <Field
            label="Role"
            placeholder="e.g. Senior Backend Engineer"
            value={role}
            onChange={setRole}
          />
          <div className="flex flex-col justify-end gap-2">
            <button
              onClick={prepOpening}
              disabled={prepping || recording}
              className="rounded-lg border border-amber/50 bg-amber/10 px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {prepping ? "prepping…" : "✦ Re-roll questions"}
            </button>
            <p className="font-mono text-[0.65rem] leading-relaxed text-muted">
              Questions auto-generate once a CV + role are set. Button re-rolls.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <section className="flex min-h-[440px] flex-col rounded-2xl border border-edge bg-panel/50">
          <PanelHeading
            kicker="Live transcript"
            note={recording ? "transcribing" : contextNote || "idle"}
          />
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-5 font-mono text-[0.95rem] leading-relaxed text-bone/90"
          >
            {transcript || interim ? (
              <p>
                {transcript} <span className="text-muted">{interim}</span>
              </p>
            ) : (
              <p className="text-muted">
                Upload a CV and set a role — opening questions appear on the
                right automatically. Start a session to go live.
              </p>
            )}
          </div>
        </section>

        <section className="flex min-h-[440px] flex-col rounded-2xl border border-amber/40 bg-gradient-to-b from-amber/[0.07] to-transparent">
          <PanelHeading
            kicker="Ask this next"
            note={`${suggestions.length} cue${suggestions.length === 1 ? "" : "s"}`}
            accent
          />
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
            <button
              onClick={() => requestSuggestion({ force: true })}
              disabled={!recording && !transcript}
              className="mb-1 self-start rounded-full border border-amber/40 px-4 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ⟳ Suggest now
            </button>

            {suggestions.length === 0 && (
              <p className="font-mono text-sm text-muted">
                Upload a CV + set a role to see opening questions here.
              </p>
            )}

            {suggestions.map((s) => (
              <div
                key={s.id}
                className="fade-up rounded-xl border border-edge bg-ink/40 px-4 py-3.5"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber/70">
                    {s.at}
                  </span>
                  {s.kind === "opening" && (
                    <span className="rounded-full border border-sage/40 bg-sage/10 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-sage">
                      opening
                    </span>
                  )}
                </div>
                {s.pending && !s.text ? (
                  <span className="thinking font-display text-lg">
                    reading the room…
                  </span>
                ) : (
                  <p className="font-display text-[1.15rem] leading-snug text-bone">
                    {s.text}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {!recording && cost && claudeCallsRef.current > 0 && (
        <CostBreakdownPanel
          cost={cost}
          calls={claudeCallsRef.current}
          overBudget={overBudget}
        />
      )}

      <KnowledgePanel candidate={candidate} onUploaded={handleUploaded} />
    </div>
  );
}

function timeNow() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function projectHourly(gbpSoFar: number) {
  return gbpSoFar;
}

function gbp(n: number) {
  return `£${n.toFixed(2)}`;
}

function CostMeter({
  cost,
  overBudget,
}: {
  cost: CostBreakdown | null;
  overBudget: boolean;
}) {
  if (!cost) return null;
  return (
    <div
      className={`flex flex-col items-end rounded-xl border px-4 py-2 ${
        overBudget ? "border-rust bg-rust/10" : "border-edge bg-ink/60"
      }`}
    >
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted">
        session cost
      </span>
      <span
        className={`font-display text-lg leading-none ${
          overBudget ? "text-rust" : "text-sage"
        }`}
      >
        {gbp(cost.totalGBP)}
      </span>
    </div>
  );
}

function CostBreakdownPanel({
  cost,
  calls,
  overBudget,
}: {
  cost: CostBreakdown;
  calls: number;
  overBudget: boolean;
}) {
  const rows = [
    ["Deepgram (transcription)", cost.deepgram],
    ["Claude Haiku (suggestions)", cost.claude],
    ["Vercel (compute, est.)", cost.vercel],
    ["Supabase (reads, est.)", cost.supabase],
  ] as const;

  return (
    <section className="fade-up mt-6 rounded-2xl border border-edge bg-panel/50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
          Session cost breakdown
        </h2>
        <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted">
          {calls} claude call{calls === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid gap-2 font-mono text-sm">
        {rows.map(([label, usd]) => (
          <div
            key={label}
            className="flex justify-between border-b border-edge/50 pb-2"
          >
            <span className="text-muted">{label}</span>
            <span className="text-bone">£{(usd * 0.79).toFixed(3)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between">
          <span className="font-display text-base text-bone">
            Total this session
          </span>
          <span
            className={`font-display text-base ${
              overBudget ? "text-rust" : "text-sage"
            }`}
          >
            {gbp(cost.totalGBP)}
          </span>
        </div>
      </div>
      {overBudget && (
        <p className="mt-3 font-mono text-[0.7rem] text-rust">
          ⚠︎ Pace exceeds the £{HOURLY_CEILING_GBP}/hr ceiling. Biggest lever:
          raise MIN_NEW_WORDS or keep the live track on Haiku (Sonnet is the pro tier).
        </p>
      )}
    </section>
  );
}

function StatusPill({
  recording,
  status,
}: {
  recording: boolean;
  status: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-edge bg-ink/60 px-4 py-2">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          recording ? "rec-dot bg-rust" : "bg-muted"
        }`}
      />
      <span className="font-mono text-xs lowercase tracking-wide text-muted">
        {status}
      </span>
    </div>
  );
}

function PanelHeading({
  kicker,
  note,
  accent,
}: {
  kicker: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-edge px-6 py-3.5">
      <h2
        className={`font-mono text-xs uppercase tracking-[0.25em] ${
          accent ? "text-amber" : "text-muted"
        }`}
      >
        {kicker}
      </h2>
      {note && (
        <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted">
          {note}
        </span>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
        {label}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
      />
    </label>
  );
}
