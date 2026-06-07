"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CallStage from "@/components/CallStage";
import KnowledgePanel from "@/components/KnowledgePanel";
import VoiceNoteButton from "@/components/VoiceNoteButton";
import SortableFocusList from "@/components/SortableFocusList";
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
  const [callType, setCallType] = useState("general");
  const [callLive, setCallLive] = useState(false);
  const [expandSetup, setExpandSetup] = useState(false);
  const [rightTab, setRightTab] = useState<"summary" | "transcript">("summary");
  const [rightMin, setRightMin] = useState(false);
  const [bullets, setBullets] = useState<{
    context: string[];
    signals: string[];
    concerns: string[];
  }>({ context: [], signals: [], concerns: [] });
  const [summaryUpdating, setSummaryUpdating] = useState(false);
  const [coverage, setCoverage] = useState<Record<string, number>>({});
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
  const personLabelRef = useRef("Them");
  const selectedCompsRef = useRef<string[]>([]);
  const suggestedCompsRef = useRef<string[]>([]);
  const cachedSummaryRef = useRef<any>(null);
  const cachedSigRef = useRef("");
  const linesRef = useRef<Line[]>([]);
  const suggestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastShownRef = useRef("");
  const recentTextsRef = useRef<string[]>([]);
  const focusChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const turnsSinceSummaryRef = useRef(0);
  const summaryInFlightRef = useRef(false);
  const bulletsRef = useRef<{
    context: string[];
    signals: string[];
    concerns: string[];
  }>({ context: [], signals: [], concerns: [] });

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    roleRef.current = role;
    personLabelRef.current = candidate.trim() || "Them";
  }, [role, candidate]);
  useEffect(() => {
    selectedCompsRef.current = selectedComps;
  }, [selectedComps]);
  useEffect(() => {
    suggestedCompsRef.current = suggestedComps;
  }, [suggestedComps]);

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
          competencies: suggestedCompsRef.current.filter((c) =>
            selectedCompsRef.current.includes(c)
          ),
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

  // Update the running summary from the conversation so far - themed bullets,
  // incremental. Runs on a light cadence (see handleCandidateTurnEnd), off the
  // cue's critical path, and guards against overlapping calls.
  const updateRunningSummary = useCallback(async () => {
    if (summaryInFlightRef.current) return;
    const labelled = linesRef.current
      .map(
        (l) =>
          `${l.role === "candidate" ? personLabelRef.current : "You"}: ${l.text}`
      )
      .join("\n");
    if (!labelled.trim()) return;
    summaryInFlightRef.current = true;
    setSummaryUpdating(true);
    try {
      const res = await fetch("/api/interview/running-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: labelled,
          previousBullets: bulletsRef.current,
          focusAreas: suggestedCompsRef.current,
          role: roleRef.current || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const next = {
          context: Array.isArray(data.context) ? data.context : [],
          signals: Array.isArray(data.signals) ? data.signals : [],
          concerns: Array.isArray(data.concerns) ? data.concerns : [],
        };
        bulletsRef.current = next;
        setBullets(next);
        if (data.coverage && typeof data.coverage === "object") {
          setCoverage(data.coverage as Record<string, number>);
        }
      }
    } catch (e) {
      console.error("Running summary failed:", e);
    } finally {
      summaryInFlightRef.current = false;
      setSummaryUpdating(false);
    }
  }, []);

  // Fires on every candidate turn-end: always request a live cue, and update
  // the running summary on a LIGHT cadence (first turn, then every 3rd) so we
  // don't double the live model load.
  const handleCandidateTurnEnd = useCallback(() => {
    requestLiveSuggestion();
    turnsSinceSummaryRef.current += 1;
    const candCount = linesRef.current.filter(
      (l) => l.role === "candidate"
    ).length;
    if (candCount === 1 || turnsSinceSummaryRef.current >= 3) {
      turnsSinceSummaryRef.current = 0;
      updateRunningSummary();
    }
  }, [requestLiveSuggestion, updateRunningSummary]);

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
  }, [selectedComps, suggestedComps, requestLiveSuggestion]);

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
    // Lock the focus list once it exists: a regenerate only refreshes the
    // character profile + opening questions and must NOT touch the focus the
    // user has ranked/edited. Only seed it on the first build.
    setSuggestedComps((prev) => (prev.length > 0 ? prev : focus));
    setSelectedComps((prev) =>
      prev.length > 0 || suggestedCompsRef.current.length > 0 ? prev : focus
    );
    setCharacter(typeof data.character === "string" ? data.character : "");
    if (typeof data.callType === "string") setCallType(data.callType);
    if (
      typeof data.subjectName === "string" &&
      data.subjectName.trim() &&
      !candidate.trim()
    ) {
      setCandidate(data.subjectName.trim());
    }

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
    // The feed renders newest-first (reversed), so insert the openers in
    // reverse: the warm/gentlest one (created first) then lands at the TOP,
    // gentle probe second, exploratory third - instead of scrolling off.
    setSuggestions((prev) => [...prev, ...[...cards].reverse()]);
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
    const sig = `${labelled}||${suggestedCompsRef.current.join(",")}`;
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
          competencies: suggestedCompsRef.current,
          callType,
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

  const deleteComp = (c: string) => {
    setSuggestedComps((prev) => prev.filter((x) => x !== c));
    setSelectedComps((prev) => prev.filter((x) => x !== c));
  };

  const addComp = (c: string) => {
    setSuggestedComps((prev) => (prev.includes(c) ? prev : [...prev, c]));
    setSelectedComps((prev) => (prev.includes(c) ? prev : [...prev, c]));
  };

  // Mid-call strip controls: move a focus left (raise priority - the leftmost
  // active focus is the one being served), and mark one done (covered) which
  // sends it to the far right. Both re-cue immediately via the focus effect.
  const moveFocusLeft = (c: string) => {
    setSuggestedComps((prev) => {
      const i = prev.indexOf(c);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  };

  const markDoneFocus = (c: string) => {
    setSelectedComps((prev) => prev.filter((x) => x !== c));
    setSuggestedComps((prev) => [...prev.filter((x) => x !== c), c]);
  };

  const togglePin = (id: number) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))
    );
  };

  const ordered = [...lines].reverse();
  const personLabel = candidate.trim() || "Them";
  const pinned = suggestions.filter((s) => s.pinned);
  const feed = suggestions.filter((s) => !s.pinned).reverse();
  // The cue engine works down the ranked list, top first; the first active
  // focus (in rank order) is the one currently being served.
  const servingFocus =
    suggestedComps.find((c) => selectedComps.includes(c)) || "";
  const setupCollapsed = callLive && !expandSetup;
  // Overall progress toward the intent: rank-weighted average of how well each
  // focus has been covered so far (top-ranked focuses count most). Page-side,
  // so reordering focus re-weights it instantly without a new model call.
  const intentPct = (() => {
    if (!suggestedComps.length) return 0;
    let wSum = 0;
    let cSum = 0;
    suggestedComps.forEach((c, i) => {
      const w = suggestedComps.length - i;
      const cov = Math.max(0, Math.min(100, coverage[c] ?? 0));
      wSum += w;
      cSum += w * cov;
    });
    return wSum ? Math.round(cSum / wSum) : 0;
  })();

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
            <span className="font-mono text-[0.7rem] font-medium tabular-nums text-bone/70">
              #{s.id}
            </span>
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

      {setupCollapsed ? (
        <button
          type="button"
          onClick={() => setExpandSetup(true)}
          className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-sage/30 bg-sage/[0.05] px-4 py-3 text-left transition hover:border-sage/50"
        >
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-sage">
            plan
          </span>
          <span className="truncate font-mono text-[0.66rem] text-muted">
            {candidate || "untitled"} · {selectedComps.length} focus active
            {suggestedComps.length - selectedComps.length > 0
              ? ` · ${suggestedComps.length - selectedComps.length} covered`
              : ""}
          </span>
          <span className="ml-auto whitespace-nowrap font-mono text-[0.6rem] uppercase tracking-wider text-muted">
            {"\u25B8"} expand setup
          </span>
        </button>
      ) : (
        <div className="mb-6 overflow-hidden rounded-2xl border border-edge bg-panel/60">
          {callLive && (
            <button
              type="button"
              onClick={() => setExpandSetup(false)}
              className="flex w-full items-center justify-end gap-2 border-b border-edge bg-ink/40 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:text-bone"
            >
              {"\u25BE"} collapse setup
            </button>
          )}
        <div className="grid lg:grid-cols-2">
          {/* LEFT - inputs */}
          <div className="flex flex-col gap-4 border-edge p-5 lg:border-r">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                  Intent - what's this call for?
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
              <p className="mt-1.5 font-mono text-[0.62rem] leading-relaxed text-muted">
                The top driver. A CV or job description is supporting context -
                with just this, you can plan a call from nothing.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted">
                  Name <span className="text-muted/60">(optional)</span>
                </span>
                <input
                  value={candidate}
                  placeholder="name, if you have one"
                  onChange={(e) => setCandidate(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted">
                  Role <span className="text-muted/60">(optional)</span>
                </span>
                <input
                  value={role}
                  placeholder="e.g. Senior PM"
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
                />
              </label>
            </div>

            <KnowledgePanel
              candidate={candidate}
              sessionId={room}
              onUploaded={handleUploaded}
            />

            {loadedDocs.length > 0 && (
              <p className="font-mono text-[0.66rem] text-muted">
                in context: {loadedDocs.join(" \u00b7 ")}
              </p>
            )}
          </div>

          {/* RIGHT - the generated plan */}
          <div className="flex flex-col gap-4 p-5">
            {character ? (
              <div className="rounded-xl border border-sage/40 bg-sage/[0.06] p-4">
                <p className="mb-1 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sage">
                  Who you're looking for
                </p>
                <p className="font-sans text-sm leading-relaxed text-bone/85">
                  {character}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-edge p-7 text-center">
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-muted">
                  Your plan appears here
                </p>
                <p className="mt-1.5 font-mono text-[0.62rem] leading-relaxed text-muted/70">
                  Add a brief (and optionally a CV + role), then build.
                </p>
              </div>
            )}

            {suggestedComps.length > 0 && (
              <div>
                <p className="mb-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-amber">
                  Focus{" "}
                  <span className="text-muted">- priority order</span>
                </p>
                <p className="mb-3 font-mono text-[0.6rem] leading-relaxed text-muted">
                  Drag or arrows to rank. Delete with{" "}
                  <span className="text-rust">{"\u00D7"}</span>, or add your
                  own. Mark one <span className="text-sage">covered</span> when
                  satisfied - still scored, re-activate any time. Rebuilding
                  won't touch this list.
                </p>
                <SortableFocusList
                  items={suggestedComps}
                  activeItems={selectedComps}
                  onReorder={setSuggestedComps}
                  onToggle={toggleComp}
                  onDelete={deleteComp}
                  onAdd={addComp}
                />
              </div>
            )}
          </div>
        </div>

        {/* CONFIRM BAR - the build gate */}
        <div className="flex flex-col items-start gap-3 border-t border-edge bg-ink/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[0.63rem] leading-relaxed text-muted">
            {suggestedComps.length > 0
              ? "Plan built. Rank your focus, then share the join link below to start. Rebuild refreshes character + questions only - your focus stays."
              : "Nothing generates until you build - no wasted calls while you type."}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={prepOpening}
              disabled={prepping || (!brief.trim() && !(cvReady && role.trim()))}
              className="rounded-full border border-amber/60 bg-amber/15 px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {prepping
                ? "building..."
                : suggestedComps.length > 0
                ? "Rebuild plan"
                : "Confirm & build plan"}
            </button>
            {suggestedComps.length > 0 && (
              <button
                onClick={() => {
                  setExpandSetup(false);
                  setCallLive(true);
                }}
                className="rounded-full border border-sage/60 bg-sage/15 px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
              >
                Start call {"\u25B8"}
              </button>
            )}
          </div>
        </div>
        </div>
      )}

      {!callLive && (
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
      )}

      {callLive && suggestedComps.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-edge bg-panel/50 px-4 py-3">
          <span className="shrink-0 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted">
            intent
          </span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink/70">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber/70 to-amber transition-all duration-700"
              style={{ width: `${intentPct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-sm font-medium tabular-nums text-amber">
            {intentPct}%
          </span>
        </div>
      )}

      {callLive && suggestedComps.length > 0 && (
        <div className="mb-3 flex items-center gap-2 overflow-x-auto rounded-2xl border border-edge bg-panel/50 px-4 py-2.5">
          <span className="shrink-0 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted">
            focus
          </span>
          {suggestedComps.map((c, i) => {
            const active = selectedComps.includes(c);
            const serving = c === servingFocus;
            return (
              <span
                key={c}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 font-mono text-[0.6rem] uppercase tracking-wider ${
                  serving
                    ? "border-amber bg-amber/15 text-amber"
                    : active
                    ? "border-edge text-muted"
                    : "border-sage/40 text-sage line-through opacity-70"
                }`}
              >
                <button
                  type="button"
                  onClick={() => moveFocusLeft(c)}
                  disabled={i === 0}
                  title="move left (raise priority)"
                  className="text-current transition hover:opacity-100 disabled:opacity-20"
                >
                  {"\u2190"}
                </button>
                {serving && (
                  <span className="text-rust" title="serving now">
                    {"\u2665"}
                  </span>
                )}
                <span>{c}</span>
                {active ? (
                  <button
                    type="button"
                    onClick={() => markDoneFocus(c)}
                    title="mark done (covered)"
                    className="text-current transition hover:text-rust"
                  >
                    {"\u00D7"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleComp(c)}
                    title="bring back into play"
                    className="text-sage transition hover:opacity-100"
                  >
                    {"\u21BA"}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="mb-6">
        <CallStage
          room={room}
          identity="Interviewer"
          role="interviewer"
          onFinalTranscript={onFinalTranscript}
          onCandidateTurnEnd={handleCandidateTurnEnd}
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

      {callLive && rightMin && (
        <button
          type="button"
          onClick={() => setRightMin(false)}
          className="mb-3 flex w-full items-center justify-end gap-2 rounded-xl border border-edge bg-panel/50 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:text-bone"
        >
          {"\u229E"} show summary / transcript
        </button>
      )}

      <div className={`grid gap-6 ${rightMin ? "" : "lg:grid-cols-[1.7fr_1fr]"}`}>
        {!rightMin && (
          <section className="flex min-h-[360px] flex-col rounded-2xl border border-edge bg-panel/50 lg:order-2">
            <div className="flex items-center border-b border-edge">
              <button
                type="button"
                onClick={() => setRightTab("summary")}
                className={`px-4 py-3 font-mono text-[0.62rem] uppercase tracking-[0.15em] transition ${
                  rightTab === "summary"
                    ? "border-b-2 border-amber text-amber"
                    : "text-muted hover:text-bone"
                }`}
              >
                Summary so far
                {summaryUpdating && (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sage align-middle" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setRightTab("transcript")}
                className={`px-4 py-3 font-mono text-[0.62rem] uppercase tracking-[0.15em] transition ${
                  rightTab === "transcript"
                    ? "border-b-2 border-amber text-amber"
                    : "text-muted hover:text-bone"
                }`}
              >
                Transcript
              </button>
              <button
                type="button"
                onClick={() => setRightMin(true)}
                title="minimise"
                className="ml-auto px-4 py-3 font-mono text-sm text-muted transition hover:text-bone"
              >
                {"\u229F"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {rightTab === "summary" ? (
                <div className="space-y-4">
                  {suggestedComps.length > 0 && (
                    <div>
                      <p className="mb-2 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
                        Intent coverage
                      </p>
                      <div className="space-y-2">
                        {suggestedComps.map((c) => {
                          const cov = Math.max(
                            0,
                            Math.min(100, coverage[c] ?? 0)
                          );
                          const active = selectedComps.includes(c);
                          return (
                            <div key={c}>
                              <div className="mb-0.5 flex items-center justify-between gap-2 font-mono text-[0.58rem] uppercase tracking-wider">
                                <span
                                  className={
                                    active
                                      ? "text-bone/80"
                                      : "text-sage line-through opacity-70"
                                  }
                                >
                                  {c}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted">
                                  {cov}%
                                </span>
                              </div>
                              <div className="relative h-1.5 overflow-hidden rounded-full bg-ink/70">
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full bg-amber/70 transition-all duration-700"
                                  style={{ width: `${cov}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {bullets.context.length +
                    bullets.signals.length +
                    bullets.concerns.length ===
                  0 ? (
                    <p className="font-mono text-sm leading-relaxed text-muted">
                      Bullets build here as the conversation goes - context,
                      signals, and concerns.
                    </p>
                  ) : (
                    <div className="space-y-4">
                    {bullets.context.length > 0 && (
                      <div>
                        <p className="mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted">
                          Context
                        </p>
                        <ul className="space-y-1.5">
                          {bullets.context.map((b, i) => (
                            <li
                              key={i}
                              className="flex gap-2 font-sans text-[0.82rem] leading-snug text-bone/80"
                            >
                              <span className="text-muted">{"\u2013"}</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {bullets.signals.length > 0 && (
                      <div>
                        <p className="mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sage">
                          Signals
                        </p>
                        <ul className="space-y-1.5">
                          {bullets.signals.map((b, i) => (
                            <li
                              key={i}
                              className="flex gap-2 font-sans text-[0.82rem] leading-snug text-bone/80"
                            >
                              <span className="text-sage">{"\u2013"}</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {bullets.concerns.length > 0 && (
                      <div>
                        <p className="mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-rust">
                          Concerns
                        </p>
                        <ul className="space-y-1.5">
                          {bullets.concerns.map((b, i) => (
                            <li
                              key={i}
                              className="flex gap-2 font-sans text-[0.82rem] leading-snug text-bone/80"
                            >
                              <span className="text-rust">{"\u2013"}</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              ) : ordered.length === 0 ? (
                <p className="font-mono text-sm text-muted">
                  Join the call and start talking. Each turn is tagged with who
                  said it.
                </p>
              ) : (
                <div className="space-y-3">
                  {ordered.map((l, i) => (
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
                          ? "You"
                          : l.role === "candidate"
                          ? personLabel
                          : l.role}
                        :
                      </span>{" "}
                      <span className="text-bone/90">{l.text}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="flex min-h-[360px] flex-col rounded-2xl border border-amber/40 bg-gradient-to-b from-amber/[0.07] to-transparent lg:order-1">
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
