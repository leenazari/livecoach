"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CallStage from "@/components/CallStage";
import KnowledgePanel from "@/components/KnowledgePanel";

type Line = { role: string; text: string };
type Suggestion = {
  id: number;
  text: string;
  followup: string;
  at: string;
  pending: boolean;
  kind: "opening" | "live";
  pinned: boolean;
};

function timeNow() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalise(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Split the streamed cue into main + optional follow-up on the marker.
function splitCue(raw: string): { ask: string; followup: string } {
  const idx = raw.indexOf("||FOLLOWUP||");
  if (idx === -1) return { ask: raw.trim(), followup: "" };
  return {
    ask: raw.slice(0, idx).trim(),
    followup: raw.slice(idx + "||FOLLOWUP||".length).trim(),
  };
}

export default function CallPage() {
  const [room] = useState(() => `lc-${Math.random().toString(36).slice(2, 8)}`);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);

  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState("");
  const [prepping, setPrepping] = useState(false);
  const [docsReady, setDocsReady] = useState(false);
  const [status, setStatus] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const knowledgeRef = useRef("");
  const roleRef = useRef("");
  const linesRef = useRef<Line[]>([]);
  const suggestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastShownRef = useRef("");
  const recentTextsRef = useRef<string[]>([]);
  const autoFiredKeyRef = useRef("");
  const autoFireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const joinLink = origin ? `${origin}/join/${room}` : "";
  const botLink = origin ? `${origin}/candidate-bot/${room}` : "";

  const copy = async () => {
    if (!joinLink) return;
    await navigator.clipboard.writeText(joinLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onFinalTranscript = useCallback((r: string, text: string) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      let next: Line[];
      if (last && last.role === r) {
        next = [...prev];
        next[next.length - 1] = { ...last, text: `${last.text} ${text}`.trim() };
      } else {
        next = [...prev, { role: r, text }];
      }
      linesRef.current = next;
      return next;
    });
  }, []);

  const isDuplicate = (text: string) => {
    const n = normalise(text);
    if (!n) return true;
    const last = normalise(lastShownRef.current);
    if (last && (n === last || n.includes(last) || last.includes(n))) return true;
    return false;
  };

  const requestLiveSuggestion = useCallback(async () => {
    if (inFlightRef.current) return;

    const labelled = linesRef.current
      .map(
        (l) =>
          `${
            l.role === "interviewer"
              ? "Interviewer"
              : l.role === "candidate"
              ? "Candidate"
              : l.role
          }: ${l.text}`
      )
      .join("\n");

    const candidateTurns = linesRef.current.filter(
      (l) => l.role === "candidate"
    );
    const latest = candidateTurns.length
      ? candidateTurns[candidateTurns.length - 1].text.slice(-400)
      : "";
    if (!latest || latest.length < 8) return;

    inFlightRef.current = true;
    const id = ++suggestIdRef.current;
    setSuggestions((prev) => [
      ...prev,
      {
        id,
        text: "",
        followup: "",
        at: timeNow(),
        pending: true,
        kind: "live",
        pinned: false,
      },
    ]);

    try {
      const res = await fetch("/api/interview/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgeContext: knowledgeRef.current,
          transcript: labelled.slice(-1600),
          latest,
          role: roleRef.current || null,
          previousSuggestions: recentTextsRef.current.slice(0, 5),
          allowHold: true,
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
        const { ask, followup } = splitCue(acc);
        setSuggestions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, text: ask, followup } : s))
        );
      }
      const { ask, followup } = splitCue(acc);
      const isHold = ask.toUpperCase() === "HOLD";
      if (isHold || isDuplicate(ask)) {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
      } else {
        lastShownRef.current = ask;
        recentTextsRef.current = [ask, ...recentTextsRef.current].slice(0, 8);
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, text: ask, followup, pending: false } : s
          )
        );
      }
    } catch (e: any) {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, text: `! ${e.message}`, pending: false } : s
        )
      );
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const loadContext = useCallback(async () => {
    const res = await fetch("/api/interview/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate: candidate || null }),
    });
    const ctx = await res.json();
    knowledgeRef.current = ctx.context || "";
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
    const cards: Suggestion[] = qs.map((q) => ({
      id: ++suggestIdRef.current,
      text: q,
      followup: "",
      at: timeNow(),
      pending: false,
      kind: "opening" as const,
      pinned: false,
    }));
    setSuggestions((prev) => [...prev, ...cards]);
    recentTextsRef.current = [...qs, ...recentTextsRef.current].slice(0, 10);
  }, [role]);

  const prepOpening = useCallback(async () => {
    setPrepping(true);
    setStatus("prepping questions...");
    try {
      await loadContext();
      await generateOpening();
      setStatus("questions ready");
    } catch (e: any) {
      const msg = e.message || "";
      setStatus(
        /cv|role|upload/i.test(msg)
          ? "waiting for a CV + role..."
          : `error: ${msg}`
      );
    } finally {
      setPrepping(false);
    }
  }, [loadContext, generateOpening]);

  useEffect(() => {
    if (!docsReady || !role.trim()) return;
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
  }, [candidate, role, docsReady, prepOpening]);

  const handleUploaded = useCallback(
    (detectedName: string | null, docType: string) => {
      if (detectedName) setCandidate(detectedName);
      setDocsReady(true);
      setStatus(
        docType === "cv" && detectedName
          ? `CV loaded - ${detectedName}`
          : "doc loaded"
      );
    },
    []
  );

  const togglePin = (id: number) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))
    );
  };

  const ordered = [...lines].reverse();
  const pinned = suggestions.filter((s) => s.pinned);
  const feed = suggestions.filter((s) => !s.pinned).reverse();

  const renderCard = (s: Suggestion) => (
    <div key={s.id} className="rounded-xl border border-edge bg-ink/40 px-4 py-3.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber/70">
          {s.at} - {s.kind}
        </span>
        <button
          onClick={() => togglePin(s.id)}
          className={`font-mono text-sm transition ${
            s.pinned ? "text-amber" : "text-muted hover:text-amber"
          }`}
          title={s.pinned ? "unpin" : "pin"}
        >
          {s.pinned ? "\u2605" : "\u2606"}
        </button>
      </div>
      {s.pending && !s.text ? (
        <span className="thinking font-display text-lg">reading the room...</span>
      ) : (
        <>
          <p className="font-display text-[1.1rem] leading-snug text-bone">
            {s.text}
          </p>
          {s.followup && (
            <p className="mt-2 flex gap-2 font-sans text-sm text-muted">
              <span className="text-amber/60">then probe:</span>
              <span>{s.followup}</span>
            </p>
          )}
        </>
      )}
    </div>
  );

  return (
    <main className="relative z-10 mx-auto max-w-[1200px] px-5 py-10">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-edge pb-5">
        <div>
          <h1 className="font-display text-[2.4rem] leading-none tracking-tight text-bone">
            <span className="italic text-amber">Live</span>Coach
          </h1>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.25em] text-muted">
            hosted interview - live cues
          </p>
        </div>
        {status && (
          <span className="rounded-full border border-edge bg-ink/60 px-4 py-2 font-mono text-xs lowercase tracking-wide text-muted">
            {status}
          </span>
        )}
      </header>

      <div className="mb-6 grid gap-4 rounded-2xl border border-edge bg-panel/60 p-5 md:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
        <label className="block">
          <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
            Candidate (auto-filled from CV)
          </span>
          <input
            value={candidate}
            placeholder="upload a CV to fill this"
            onChange={(e) => setCandidate(e.target.value)}
            className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
            Role
          </span>
          <input
            value={role}
            placeholder="e.g. Senior Backend Engineer"
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
          />
        </label>
        <div className="flex flex-col justify-end gap-2">
          <button
            onClick={prepOpening}
            disabled={prepping}
            className="rounded-lg border border-amber/50 bg-amber/10 px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {prepping ? "prepping..." : "Re-roll questions"}
          </button>
          <p className="font-mono text-[0.65rem] leading-relaxed text-muted">
            Auto-generates once a CV + role are set.
          </p>
        </div>
      </div>

      <KnowledgePanel candidate={candidate} onUploaded={handleUploaded} />

      <div className="my-6 grid gap-3 rounded-2xl border border-amber/40 bg-amber/[0.06] p-5">
        <div>
          <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
            Real candidate - send this link
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="break-all rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-sm text-bone">
              {joinLink || "preparing..."}
            </code>
            <button
              onClick={copy}
              disabled={!joinLink}
              className="rounded-full border border-amber/50 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/10 disabled:opacity-40"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        </div>
        <div className="border-t border-edge/50 pt-3">
          <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-sage">
            Test solo - open the candidate bot in a new tab
          </p>
          <a
            href={botLink || "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-full border border-sage/50 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-sage transition hover:bg-sage/10"
          >
            Open candidate bot (same room)
          </a>
        </div>
      </div>

      <div className="mb-6">
        <CallStage
          room={room}
          identity="Interviewer"
          role="interviewer"
          onFinalTranscript={onFinalTranscript}
          onCandidateTurnEnd={requestLiveSuggestion}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="flex min-h-[360px] flex-col rounded-2xl border border-edge bg-panel/50">
          <div className="border-b border-edge px-6 py-3.5">
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
              Labelled transcript - newest first
            </h2>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            {ordered.length === 0 ? (
              <p className="font-mono text-sm text-muted">
                Join the call and start talking. Each turn is tagged with who
                said it.
              </p>
            ) : (
              ordered.map((l, i) => (
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

        <section className="flex min-h-[360px] flex-col rounded-2xl border border-amber/40 bg-gradient-to-b from-amber/[0.07] to-transparent">
          <div className="border-b border-edge px-6 py-3.5">
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-amber">
              Ask this next
            </h2>
          </div>

          {pinned.length > 0 && (
            <div className="border-b border-edge/60 px-5 py-4">
              <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-amber/70">
                Pinned
              </p>
              <div className="flex flex-col gap-2">{pinned.map(renderCard)}</div>
            </div>
          )}

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
            {feed.length === 0 ? (
              <p className="font-mono text-sm text-muted">
                Upload a CV + set a role for opening questions. Live cues appear
                as the candidate answers.
              </p>
            ) : (
              feed.map(renderCard)
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
