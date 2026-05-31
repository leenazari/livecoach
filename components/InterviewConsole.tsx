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
};

const SUGGEST_INTERVAL_MS = 5000;

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

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef("");
  const knowledgeRef = useRef("");
  const suggestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const startedAtRef = useRef(0);
  const claudeCallsRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suggestTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, interim]);

  const requestSuggestion = useCallback(async () => {
    if (inFlightRef.current) return;
    const full = transcriptRef.current.trim();
    if (full.length < 12) return;

    inFlightRef.current = true;
    claudeCallsRef.current += 1;

    const recentWindow = full.slice(-1000);
    const latest = full.slice(-350);
    const id = ++suggestIdRef.current;

    setSuggestions((prev) => [
      { id, text: "", at: timeNow(), pending: true },
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
      setSuggestions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pending: false } : s))
      );
    } catch (e: any) {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, text: `⚠︎ ${e.message}`, pending: false } : s
        )
      );
    } finally {
      inFlightRef.current = false;
    }
  }, [role]);

  const start = useCallback(async () => {
    try {
      setStatus("loading knowledge…");
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
          : "no docs — upload some first"
      );

      setStatus("getting microphone…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      setStatus("authorising transcription…");
      const tokenRes = await fetch("/api/deepgram/token");
      if (!tokenRes.ok) throw new Error("Could not get Deepgram token");
      const { access_token } = await tokenRes.json();

      const params = new URLSearchParams({
        model: "nova-2",
        smart_format: "true",
        punctuate: "true",
        interim_results: "true",
        endpointing: "300",
        language: "en",
        token: access_token,
      });

      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params.toString()}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("listening");
        setRecording(true);
        setSetupOpen(false);
        startedAtRef.current = Date.now();
        claudeCallsRef.current = 0;

        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };
        recorder.start(250);

        suggestTimerRef.current = setInterval(
          requestSuggestion,
          SUGGEST_INTERVAL_MS
        );

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
      ws.onclose = () => stopTimers();
    } catch (e: any) {
      setStatus(`error: ${e.message}`);
      setRecording(false);
    }
  }, [candidate, requestSuggestion]);

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
            live suggestions every 5s · haiku tier
          </p>
        </div>

        <div className="flex items-center gap-3">
          <CostMeter cost={cost} overBudget={overBudget} />
          <StatusPill recording={recording} status={status} />
          {!recording ? (
            <button
              onClick={start}
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
            label="Candidate"
            placeholder="e.g. Priya Sharma"
            value={candidate}
            onChange={setCandidate}
          />
          <Field
            label="Role"
            placeholder="e.g. Senior Backend Engineer"
            value={role}
            onChange={setRole}
          />
          <div className="flex items-end">
            <p className="font-mono text-[0.7rem] leading-relaxed text-muted">
              Candidate name scopes the CV &amp; summary loaded at start. Upload
              docs below first. Framework docs load for every session.
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
                Transcript appears here as you talk. Suggestions stream in every
                five seconds, synced to the conversation — not waiting for a pause.
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
              onClick={requestSuggestion}
              disabled={!recording && !transcript}
              className="mb-1 self-start rounded-full border border-amber/40 px-4 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ⟳ Suggest now
            </button>

            {suggestions.length === 0 && (
              <p className="font-mono text-sm text-muted">Waiting for the first words…</p>
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

      <KnowledgePanel candidate={candidate} />
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
          {calls} suggestion call{calls === 1 ? "" : "s"}
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
          slow the interval or keep the live track on Haiku (Sonnet is the pro tier).
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
