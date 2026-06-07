"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CallStage from "@/components/CallStage";
import KnowledgePanel from "@/components/KnowledgePanel";
import VoiceNoteButton from "@/components/VoiceNoteButton";
import PostCallSummary from "@/components/PostCallSummary";

type Line = { role: string; text: string };
type Suggestion = {
  id: number;
  text: string;
  why: string;
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

function splitCue(raw: string): { ask: string; why: string; followup: string } {
  // Tolerant of spacing/case variants of the markers, and strips any strays
  // so a literal ||FOLLOWUP|| can never show in the UI.
  const WHY = /\|\|\s*WHY\s*\|\|/i;
  const FUP = /\|\|\s*FOLLOWUP\s*\|\|/i;
  const strip = (t: string) =>
    t
      .replace(/\|\|\s*(WHY|FOLLOWUP)\s*\|\|/gi, " ")
      .replace(/\|\|/g, " ")
      .trim();

  let ask = raw;
  let why = "";
  let followup = "";

  const wParts = raw.split(WHY);
  if (wParts.length > 1) {
    ask = wParts[0];
    const rest = wParts.slice(1).join(" ");
    const fParts = rest.split(FUP);
    why = fParts[0];
    followup = fParts.slice(1).join(" ");
  } else {
    const fParts = raw.split(FUP);
    ask = fParts[0];
    followup = fParts.slice(1).join(" ");
  }
  return { ask: strip(ask), why: strip(why), followup: strip(followup) };
}

export default function CallPage() {
  const [room] = useState(() => `lc-${Math.random().toString(36).slice(2, 8)}`);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);

  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState("");
  const [brief, setBrief] = useState("");
  const [character, setCharacter] = useState("");
  const [prepping, setPrepping] = useState(false);
  const [docsReady, setDocsReady] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const [status, setStatus] = useState("");
  const [loadedDocs, setLoadedDocs] = useState<string[]>([]);
  const [suggestedComps, setSuggestedComps] = useState<string[]>([]);
  const [selectedComps, setSelectedComps] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [summarising, setSummarising] = useState(false);
  const [summaryTranscript, setSummaryTranscript] = useState("");

  const knowledgeRef = useRef("");
  const roleRef = useRef("");
  const selectedCompsRef = useRef<string[]>([]);
  const cachedSummaryRef = useRef<any>(null);
  const cachedSigRef = useRef("");
  const linesRef = useRef<Line[]>([]);
  const suggestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastShownRef = useRef("");
  const recentTextsRef = useRef<string[]>([]);
  const autoFiredKeyRef = useRef("");
  const autoFireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    selectedCompsRef.current = selectedComps;
  }, [selectedComps]);

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

    const interviewerTurns = linesRef.current.filter(
      (l) => l.role === "interviewer"
    );
    const askedQuestions = interviewerTurns.map((l) => l.text);
    const lastQuestion = interviewerTurns.length
      ? interviewerTurns[interviewerTurns.length - 1].text
      : "";

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
        why: "",
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
          transcript: labelled.slice(-2400),
          latest,
          role: roleRef.current || null,
          previousSuggestions: recentTextsRef.current.slice(0, 5),
          askedQuestions,
          lastQuestion,
          competencies: selectedCompsRef.current,
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
        const { ask, why, followup } = splitCue(acc);
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, text: ask, why, followup } : s
          )
        );
      }
      const { ask, why, followup } = splitCue(acc);
      const isHold = ask.toUpperCase() === "HOLD";
      if (isHold || isDuplicate(ask)) {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
      } else {
        lastShownRef.current = ask;
        recentTextsRef.current = [ask, ...recentTextsRef.current].slice(0, 8);
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, text: ask, why, followup, pending: false }
              : s
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

  // Changing the interview focus mid-call should re-cue immediately against the
  // conversation so far - so the new focus is reflected right where we are now,
  // not only on the next candidate turn. Debounced so toggling fires once.
  useEffect(() => {
    const hasCandidateTurn = linesRef.current.some(
      (l) => l.role === "candidate"
    );
    if (!hasCandidateTurn || selectedComps.length === 0) return;
    if (focusChangeTimerRef.current) clearTimeout(focusChangeTimerRef.current);
    focusChangeTimerRef.current = setTimeout(() => {
      requestLiveSuggestion();
    }, 600);
    return () => {
      if (focusChangeTimerRef.current) clearTimeout(focusChangeTimerRef.current);
    };
  }, [selectedComps, requestLiveSuggestion]);

  const loadContext = useCallback(async () => {
    const res = await fetch("/api/interview/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: room }),
    });
    const ctx = await res.json();
    knowledgeRef.current = ctx.context || "";
    setLoadedDocs(Array.isArray(ctx.sources) ? ctx.sources : []);
    return knowledgeRef.current;
  }, [candidate]);

  // Intent-driven plan: brief (top priority) + CV/JD context -> ranked focus
  // areas + character profile + opening questions, in one call.
  const generatePlan = useCallback(async () => {
    const res = await fetch("/api/interview/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: brief || null,
        role: role || null,
        knowledgeContext: knowledgeRef.current,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to build plan");

    const focus: string[] = Array.isArray(data.focusAreas)
      ? data.focusAreas
      : [];
    setSuggestedComps(focus); // ranked, most important first
    setSelectedComps(focus); // all active to start, in rank order
    setCharacter(typeof data.character === "string" ? data.character : "");

    const qs: any[] = Array.isArray(data.openingQuestions)
      ? data.openingQuestions
      : [];
    const cards: Suggestion[] = qs.map((item) => ({
      id: ++suggestIdRef.current,
      text: typeof item === "string" ? item : item.q || "",
      why: typeof item === "string" ? "" : item.why || "",
      followup: "",
      at: timeNow(),
      pending: false,
      kind: "opening" as const,
      pinned: false,
    }));
    setSuggestions((prev) => [...prev, ...cards]);
    recentTextsRef.current = [
      ...cards.map((c) => c.text),
      ...recentTextsRef.current,
    ].slice(0, 10);
  }, [brief, role]);


  const prepOpening = useCallback(async () => {
    setPrepping(true);
    setStatus("building plan...");
    try {
      await loadContext();
      await generatePlan();
      setStatus("plan ready");
    } catch (e: any) {
      setStatus(`error: ${e.message || "could not build plan"}`);
    } finally {
      setPrepping(false);
    }
  }, [loadContext, generatePlan]);

  // Auto-build the plan when there's enough to plan from: a written intent
  // brief (the top driver) OR a CV + role. Whichever arrives, once per combo.
  useEffect(() => {
    const haveBrief = brief.trim().length > 15;
    const haveCvRole = cvReady && role.trim().length > 0;
    if (!haveBrief && !haveCvRole) return;
    const key = `${brief.trim()}|${candidate}|${role.trim()}`;
    if (autoFiredKeyRef.current === key) return;
    if (autoFireTimerRef.current) clearTimeout(autoFireTimerRef.current);
    autoFireTimerRef.current = setTimeout(() => {
      autoFiredKeyRef.current = key;
      prepOpening();
    }, 1200);
    return () => {
      if (autoFireTimerRef.current) clearTimeout(autoFireTimerRef.current);
    };
  }, [brief, candidate, role, cvReady, prepOpening]);

  const handleUploaded = useCallback(
    (detectedName: string | null, docType: string) => {
      if (detectedName) setCandidate(detectedName);
      setDocsReady(true);
      if (docType === "cv") setCvReady(true);
      setStatus(
        docType === "cv"
          ? detectedName
            ? `CV loaded - ${detectedName}`
            : "CV loaded"
          : "doc loaded"
      );
    },
    []
  );

  const endAndSummarise = useCallback(async () => {
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
    if (labelled.length < 30) {
      setStatus("not enough conversation yet to summarise");
      return;
    }
    setSummaryTranscript(labelled);
    const sig = `${labelled}||${selectedCompsRef.current.join(",")}`;
    // Same call, already summarised -> just re-show the saved results.
    if (cachedSummaryRef.current && cachedSigRef.current === sig) {
      setSummary(cachedSummaryRef.current);
      setStatus("showing saved summary");
      return;
    }
    setSummarising(true);
    setStatus("building summary...");
    try {
      const res = await fetch("/api/interview/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: labelled,
          knowledgeContext: knowledgeRef.current,
          role: roleRef.current || null,
          candidate: candidate || null,
          competencies: selectedCompsRef.current,
          sessionId: room,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Summary failed");
      cachedSummaryRef.current = data.summary;
      cachedSigRef.current = sig;
      setSummary(data.summary);
      setStatus("summary ready");
    } catch (e: any) {
      setStatus(`error: ${e.message}`);
    } finally {
      setSummarising(false);
    }
  }, [candidate]);

  const appendBrief = useCallback((t: string) => {
    setBrief((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t));
  }, []);

  const toggleComp = (c: string) => {
    setSelectedComps((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const togglePin = (id: number) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))
    );
  };

  const ordered = [...lines].reverse();
  const pinned = suggestions.filter((s) => s.pinned);
  const feed = suggestions.filter((s) => !s.pinned).reverse();

  // Cue card: question is the hero, why is a tiny tag, follow-up is a
  // clearly separated optional section.
  const cueType = (s: Suggestion): "opening" | "redirect" | "question" => {
    if (s.kind === "opening") return "opening";
    if (
      /didn'?t\s+answer|didn'?t\s+address|off.?topic|changed the subject|redirect|not answer/i.test(
        s.why
      )
    )
      return "redirect";
    return "question";
  };

  const TYPE_META: Record<
    string,
    { border: string; badge: string; whyColor: string; label: string }
  > = {
    question: {
      border: "border-amber/40",
      badge: "border-amber/40 bg-amber/15 text-amber",
      whyColor: "text-amber/60",
      label: "ASK",
    },
    redirect: {
      border: "border-rust/60",
      badge: "border-rust/50 bg-rust/15 text-rust",
      whyColor: "text-rust/75",
      label: "REDIRECT",
    },
    opening: {
      border: "border-sage/40",
      badge: "border-sage/40 bg-sage/15 text-sage",
      whyColor: "text-sage/70",
      label: "OPENING",
    },
  };

  const renderCard = (s: Suggestion) => {
    const meta = TYPE_META[cueType(s)];
    return (
      <div
        key={s.id}
        className={`overflow-hidden rounded-xl border ${meta.border} bg-ink/40`}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.2em] ${meta.badge}`}
            >
              {meta.label}
            </span>
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-muted">
              {s.at}
            </span>
          </div>
          <button
            onClick={() => togglePin(s.id)}
            className={`text-lg leading-none transition ${
              s.pinned ? "text-amber" : "text-muted hover:text-amber"
            }`}
            title={s.pinned ? "unpin" : "pin"}
          >
            {s.pinned ? "\u2605" : "\u2606"}
          </button>
        </div>

        {s.pending && !s.text ? (
          <div className="px-4 pb-4 pt-2">
            <span className="thinking font-display text-lg">
              reading the room...
            </span>
          </div>
        ) : (
          <>
            <div className="px-4 pb-4 pt-2">
              <p className="font-display text-[1.45rem] font-medium leading-snug text-bone">
                {s.text}
              </p>
              {s.why && (
                <p
                  className={`mt-2.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] ${meta.whyColor}`}
                >
                  {s.why}
                </p>
              )}
            </div>
            {s.followup && (
              <div className="border-t border-edge/70 bg-ink/50 px-4 py-3">
                <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.22em] text-sage/70">
                  then go deeper
                </p>
                <p className="font-sans text-[1rem] leading-snug text-bone/85">
                  {s.followup}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

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

      <div className="mb-3 rounded-2xl border border-amber/40 bg-amber/[0.06] p-5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
            What's this call for? (the intent - drives everything)
          </span>
          <VoiceNoteButton onText={appendBrief} />
        </div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder="e.g. Met Steve at a wedding - he runs a finance business and wants help building software. I want to understand his needs, whether he's a serious buyer, and what kind of system fits."
          className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
        />
        <p className="mt-1.5 font-mono text-[0.65rem] leading-relaxed text-muted">
          The brief is the top driver. A CV or job description (below) is
          supporting context. With just this, you can plan a call from nothing.
        </p>
      </div>

      <div className="mb-3 grid gap-4 rounded-2xl border border-edge bg-panel/60 p-5 md:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
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
            {prepping ? "building..." : "Build plan"}
          </button>
          <p className="font-mono text-[0.65rem] leading-relaxed text-muted">
            Auto-builds from a brief, or a CV + role.
          </p>
        </div>
      </div>

      {loadedDocs.length > 0 && (
        <p className="mb-3 font-mono text-[0.7rem] text-muted">
          in context: {loadedDocs.join(" \u00b7 ")}
        </p>
      )}

      {character && (
        <div className="mb-3 rounded-2xl border border-sage/40 bg-sage/[0.06] p-5">
          <p className="mb-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-sage">
            Who you're looking for
          </p>
          <p className="font-sans text-sm leading-relaxed text-bone/85">
            {character}
          </p>
        </div>
      )}

      {suggestedComps.length > 0 && (
        <div className="mb-5 rounded-2xl border border-edge bg-panel/50 p-5">
          <p className="mb-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
            Interview focus <span className="text-muted">- in priority order</span>
          </p>
          <p className="mb-3 font-mono text-[0.65rem] text-muted">
            Tap the competencies that matter for this hire - cues will steer toward them.
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestedComps.map((c, i) => {
              const on = selectedComps.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleComp(c)}
                  className={`rounded-full border px-3.5 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
                    on
                      ? "border-amber bg-amber/15 text-amber"
                      : "border-edge text-muted hover:border-amber/50 hover:text-bone line-through opacity-60"
                  }`}
                >
                  <span className="opacity-60">{i + 1}.</span> {c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <KnowledgePanel candidate={candidate} sessionId={room} onUploaded={handleUploaded} />

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

      <div className="mb-6 flex justify-center">
        <button
          onClick={endAndSummarise}
          disabled={summarising}
          className="rounded-full border border-amber/50 bg-amber/10 px-7 py-3 font-mono text-sm uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {summarising ? "summarising..." : "End interview & summarise"}
        </button>
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

      {summary && (
        <PostCallSummary
          summary={summary}
          candidate={candidate}
          transcript={summaryTranscript}
          onClose={() => setSummary(null)}
        />
      )}
    </main>
  );
}
