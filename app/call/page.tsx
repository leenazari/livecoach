"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CallStage from "@/components/CallStage";
import MeetStage from "@/components/MeetStage";
import KnowledgePanel from "@/components/KnowledgePanel";
import VoiceNoteButton from "@/components/VoiceNoteButton";
import SortableFocusList from "@/components/SortableFocusList";
import PostCallSummary from "@/components/PostCallSummary";
import CostMeter from "@/components/CostMeter";
import MatrixRain from "@/components/MatrixRain";
import {
  estimateCost,
  usageCostUSD,
  knowledgeTokensFromText,
  projectHourlyGBP,
  HOURLY_CEILING_GBP,
  type CostBreakdown,
} from "@/lib/costs";

type Line = { role: string; text: string; speaker?: string };
type Suggestion = {
  id: number;
  text: string;
  why: string;
  followup: string;
  at: string;
  pending: boolean;
  kind: "opening" | "live" | "insight";
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

function addUsageToRef(ref: { current: number }, res: Response) {
  try {
    const u = res.headers.get("x-usage");
    const m = res.headers.get("x-model");
    if (u && (m === "haiku" || m === "sonnet")) {
      ref.current += usageCostUSD(m, JSON.parse(u));
    }
  } catch {
    /* ignore */
  }
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
  const [source, setSource] = useState<"inapp" | "meet">("inapp");
  const [meetingUrl, setMeetingUrl] = useState("");
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
  const [playbook, setPlaybook] = useState<{ label: string; detail: string }[]>([]);
  const [privateNotes, setPrivateNotes] = useState<string[]>([]);
  const [publicLink, setPublicLink] = useState("");
  const [background, setBackground] = useState("");
  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState("");
  const [cost, setCost] = useState<CostBreakdown>(() => estimateCost(0, 0));
  const [overBudget, setOverBudget] = useState(false);
  const [meterOn, setMeterOn] = useState(false);
  const [insightsOn, setInsightsOn] = useState(true);
  const [cueFull, setCueFull] = useState(false);

  const knowledgeRef = useRef("");
  const claudeCallsRef = useRef(0);
  const claudeUsdRef = useRef(0);
  const callStartedAtRef = useRef(0);
  const costTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sonnetCallsRef = useRef(0);
  const callLiveRef = useRef(false);
  const sourceRef = useRef<"inapp" | "meet">("inapp");
  const backgroundRef = useRef("");
  const callTypeRef = useRef("general");
  const roleRef = useRef("");
  const personLabelRef = useRef("Them");
  const candidateRef = useRef("");
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
  const lastCueAtRef = useRef(0);
  const cueGapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insightInFlightRef = useRef(false);
  const recentInsightsRef = useRef<string[]>([]);
  const insightCallsRef = useRef(0);
  const lastInsightLenRef = useRef(0);
  const bulletsRef = useRef<{
    context: string[];
    signals: string[];
    concerns: string[];
  }>({ context: [], signals: [], concerns: [] });

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Cost meter. Turns on the moment a plan is built OR a call goes live
  // (whichever first), so the cost is visible from the first billable action.
  // Claude cost (plan + cues + scorecard) accrues from call counts; Deepgram +
  // transport + infra only accrue while actually transcribing (call live), so
  // sitting on the plan screen doesn't run the meter up on transport you're not
  // using yet.
  useEffect(() => {
    if (!meterOn) return;
    const tick = () => {
      const transcribing =
        callLiveRef.current && callStartedAtRef.current
          ? (Date.now() - callStartedAtRef.current) / 1000
          : 0;
      const meet = sourceRef.current === "meet";
      const c = estimateCost(transcribing, 0, {
        deepgramStreams: meet ? 0 : 2,
        transport: meet ? "recall" : "livekit",
        claudeUsd: claudeUsdRef.current,
      });
      setCost(c);
      setOverBudget(
        projectHourlyGBP(c.totalGBP, transcribing) > HOURLY_CEILING_GBP
      );
    };
    tick();
    costTickRef.current = setInterval(tick, 4000);
    return () => {
      if (costTickRef.current) clearInterval(costTickRef.current);
    };
  }, [meterOn]);
  useEffect(() => {
    roleRef.current = role;
    personLabelRef.current = candidate.trim() || "Them";
    candidateRef.current = candidate.trim();
  }, [role, candidate]);
  useEffect(() => {
    selectedCompsRef.current = selectedComps;
  }, [selectedComps]);
  useEffect(() => {
    suggestedCompsRef.current = suggestedComps;
  }, [suggestedComps]);
  useEffect(() => {
    callTypeRef.current = callType;
  }, [callType]);
  useEffect(() => {
    callLiveRef.current = callLive;
    if (callLive && !callStartedAtRef.current) callStartedAtRef.current = Date.now();
    if (callLive) setMeterOn(true);
  }, [callLive]);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const joinLink = origin ? `${origin}/join/${room}` : "";
  const botLink = origin ? `${origin}/candidate-bot/${room}` : "";

  const copy = async () => {
    if (!joinLink) return;
    await navigator.clipboard.writeText(joinLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onFinalTranscript = useCallback(
    (r: string, text: string, speaker?: string) => {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        let next: Line[];
        if (
          last &&
          last.role === r &&
          (last.speaker || "") === (speaker || "")
        ) {
          next = [...prev];
          next[next.length - 1] = {
            ...last,
            text: `${last.text} ${text}`.trim(),
          };
        } else {
          next = [...prev, { role: r, text, speaker }];
        }
        linesRef.current = next;
        return next;
      });
    },
    []
  );

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
              ? l.speaker || "Candidate"
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
    const lastCandidate = candidateTurns.length
      ? candidateTurns[candidateTurns.length - 1]
      : null;
    const latest = lastCandidate ? lastCandidate.text.slice(-400) : "";
    const latestSpeaker = lastCandidate?.speaker || "";
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

    // Abort a hung request so a mic-toggle renegotiation stall can't leave
    // inFlightRef stuck true and silently freeze all future cues.
    const controller = new AbortController();
    const cueTimer = setTimeout(() => controller.abort(), 25000);
    try {
      claudeCallsRef.current += 1;
      const res = await fetch("/api/interview/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          knowledgeContext: knowledgeRef.current,
          transcript: labelled.slice(-2400),
          latest,
          latestSpeaker,
          subjectName: candidateRef.current || null,
          role: roleRef.current || null,
          callType: callTypeRef.current,
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
      const stripUsageTail = (x: string) =>
        x.replace(/\n?\|\|USAGE\|\|[\s\S]*$/, "");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const { ask, why, followup } = splitCue(stripUsageTail(acc));
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, text: ask, why, followup } : s
          )
        );
      }
      // Bank the exact token usage appended to the stream.
      const um = acc.match(/\|\|USAGE\|\|([\s\S]*?)\|\|ENDUSAGE\|\|/);
      if (um) {
        try {
          const parsed = JSON.parse(um[1]);
          if (parsed?.usage)
            claudeUsdRef.current += usageCostUSD("haiku", parsed.usage);
        } catch {
          /* ignore */
        }
      }
      const { ask, why, followup } = splitCue(stripUsageTail(acc));
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
      clearTimeout(cueTimer);
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
          `${l.role === "candidate" ? l.speaker || personLabelRef.current : "You"}: ${l.text}`
      )
      .join("\n");
    if (!labelled.trim()) return;
    summaryInFlightRef.current = true;
    setSummaryUpdating(true);
    // Abort a hung request so a stalled fetch (e.g. during a mute toggle's mic
    // renegotiation) can't leave summaryInFlightRef stuck and freeze updates.
    const controller = new AbortController();
    const sumTimer = setTimeout(() => controller.abort(), 20000);
    try {
      claudeCallsRef.current += 1;
      const res = await fetch("/api/interview/running-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          transcript: labelled,
          previousBullets: bulletsRef.current,
          focusAreas: suggestedCompsRef.current,
          role: roleRef.current || null,
        }),
      });
      const data = await res.json();
      addUsageToRef(claudeUsdRef, res);
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
      clearTimeout(sumTimer);
      summaryInFlightRef.current = false;
      setSummaryUpdating(false);
    }
  }, []);

  // ADVISOR LANE (pro). Every ~30s a Sonnet pass offers the single best thing
  // to SAY - a technical point, example, accurate analogy, or genuine quote -
  // not a question. Only fires when there's new discussion; HOLDs are dropped.
  const requestInsight = useCallback(async () => {
    if (insightInFlightRef.current) return;
    const lines = linesRef.current;
    if (lines.length < 2 || lines.length <= lastInsightLenRef.current) return;

    const labelled = lines
      .map(
        (l) =>
          `${
            l.role === "candidate" ? l.speaker || personLabelRef.current : "You"
          }: ${l.text}`
      )
      .join("\n")
      .slice(-3000);
    if (!labelled.trim()) return;

    insightInFlightRef.current = true;
    lastInsightLenRef.current = lines.length;
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
        kind: "insight",
        pinned: false,
      },
    ]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      insightCallsRef.current += 1;
      const res = await fetch("/api/interview/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          knowledgeContext: knowledgeRef.current,
          transcript: labelled,
          role: roleRef.current || null,
          subjectName: candidateRef.current || null,
          recentInsights: recentInsightsRef.current.slice(0, 5),
        }),
      });
      addUsageToRef(claudeUsdRef, res);
      const text = (await res.text()).trim();
      const { ask, why } = splitCue(text);
      if (!ask || ask.toUpperCase() === "HOLD") {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
      } else {
        recentInsightsRef.current = [ask, ...recentInsightsRef.current].slice(
          0,
          6
        );
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, text: ask, why, pending: false } : s
          )
        );
      }
    } catch {
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      clearTimeout(timer);
      insightInFlightRef.current = false;
    }
  }, []);

  // Advisor lane: one Sonnet pass every ~30s while the call is live AND the
  // smart-insights switch is on (off by call when you don't want the pro cost).
  useEffect(() => {
    if (!callLive || !insightsOn) return;
    const id = setInterval(() => {
      requestInsight();
    }, 30000);
    return () => clearInterval(id);
  }, [callLive, insightsOn, requestInsight]);

  // Fires on every candidate turn-end: always request a live cue, and update
  // the running summary on a LIGHT cadence (first turn, then every 2nd) so we
  // don't triple the live model load.
  const handleCandidateTurnEnd = useCallback(() => {
    // Pace the cues: at most one every ~9s. Rapid turns (e.g. a 3-way call)
    // coalesce into a single, well-timed cue built from the latest context, so
    // they don't flood in faster than you can read.
    const MIN_CUE_GAP_MS = 9000;
    const now = Date.now();
    const since = now - lastCueAtRef.current;
    if (since >= MIN_CUE_GAP_MS) {
      lastCueAtRef.current = now;
      requestLiveSuggestion();
    } else {
      if (cueGapTimerRef.current) clearTimeout(cueGapTimerRef.current);
      cueGapTimerRef.current = setTimeout(() => {
        lastCueAtRef.current = Date.now();
        requestLiveSuggestion();
      }, MIN_CUE_GAP_MS - since);
    }
    turnsSinceSummaryRef.current += 1;
    const candCount = linesRef.current.filter(
      (l) => l.role === "candidate"
    ).length;
    if (candCount === 1 || turnsSinceSummaryRef.current >= 2) {
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
    claudeCallsRef.current += 1;
    const res = await fetch("/api/interview/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: brief || null,
        role: role || null,
        knowledgeContext: [
          knowledgeRef.current,
          backgroundRef.current
            ? `PUBLIC PAGE RESEARCH (about the person / company):\n${backgroundRef.current}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    });
    const data = await res.json();
    addUsageToRef(claudeUsdRef, res);
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
    setPlaybook(
      Array.isArray(data.playbook)
        ? data.playbook.filter(
            (p: any) => p && typeof p.label === "string" && typeof p.detail === "string"
          )
        : []
    );
    setPrivateNotes(
      Array.isArray(data.privateNotes)
        ? data.privateNotes.filter((x: any) => typeof x === "string" && x.trim())
        : []
    );
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

    // Report whether a real plan came back, and whether it's the generic
    // fallback, so the status line stays honest.
    const ok = focus.length > 0 || suggestedCompsRef.current.length > 0;
    return { ok, degraded: data.degraded === true };
  }, [brief, role]);


  const prepOpening = useCallback(async () => {
    setPrepping(true);
    setMeterOn(true);
    setStatus("building plan...");
    try {
      await loadContext();
      const { ok, degraded } = await generatePlan();
      setStatus(
        !ok
          ? "no plan came back - tap Build plan to try again"
          : degraded
          ? "plan ready (generic - rebuild for a tailored plan)"
          : "plan ready"
      );
    } catch (e: any) {
      setStatus(`error: ${e.message || "could not build plan"}`);
    } finally {
      setPrepping(false);
    }
  }, [loadContext, generatePlan]);

  const persistSession = useCallback(() => {
    // Fire-and-forget: record the call's intent server-side so a scorecard can
    // be produced even if the call ends without the End button (e.g. a Meet
    // call where the tab is closed). Failure here must never block the call.
    fetch("/api/interview/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: room,
        brief,
        role,
        callType,
        competencies: suggestedComps.filter((c) => selectedComps.includes(c)),
        candidate,
        source,
      }),
    }).catch(() => {});
  }, [room, brief, role, callType, suggestedComps, selectedComps, candidate, source]);

  const research = useCallback(async () => {
    const url = publicLink.trim();
    if (!url) return;
    setResearching(true);
    setResearchNote("");
    try {
      const res = await fetch("/api/interview/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (res.ok && data.background) {
        setBackground(data.background);
        backgroundRef.current = data.background;
        setResearchNote(`\u2713 added context from ${data.site || "the page"}`);
      } else {
        setResearchNote(
          data.error || "couldn't read that page \u2013 carry on without it"
        );
      }
    } catch {
      setResearchNote("couldn't reach that page \u2013 carry on without it");
    } finally {
      setResearching(false);
    }
  }, [publicLink]);

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
    // Stop any Meet bot tied to this session so it can't linger billing - works
    // by session id, so it doesn't matter that the browser holds no bot id.
    // No-op for in-app calls (no active bot for this room). Fire and forget.
    fetch("/api/meet/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: room }),
    }).catch(() => {});

    const labelled = linesRef.current
      .map(
        (l) =>
          `${
            l.role === "interviewer"
              ? "Interviewer"
              : l.role === "candidate"
              ? l.speaker || "Candidate"
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
      sonnetCallsRef.current += 1;
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
      addUsageToRef(claudeUsdRef, res);
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

  const briefRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-follow: keep the newest text in view as the brief grows (e.g. while a
  // voice note streams in).
  useEffect(() => {
    const el = briefRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [brief]);

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
  const cueType = (
    s: Suggestion
  ): "opening" | "redirect" | "question" | "statement" => {
    if (s.kind === "insight") return "statement";
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
    {
      border: string;
      borderBright: string;
      badge: string;
      whyColor: string;
      label: string;
    }
  > = {
    question: {
      border: "border-amber/40",
      borderBright: "border-amber ring-1 ring-amber/40",
      badge: "border-amber/40 bg-amber/15 text-amber",
      whyColor: "text-amber/60",
      label: "ASK",
    },
    redirect: {
      border: "border-rust/60",
      borderBright: "border-rust ring-1 ring-rust/40",
      badge: "border-rust/50 bg-rust/15 text-rust",
      whyColor: "text-rust/75",
      label: "REDIRECT",
    },
    opening: {
      border: "border-sage/40",
      borderBright: "border-sage ring-1 ring-sage/40",
      badge: "border-sage/40 bg-sage/15 text-sage",
      whyColor: "text-sage/70",
      label: "OPENING",
    },
    statement: {
      border: "border-sky/40",
      borderBright: "border-sky ring-1 ring-sky/40",
      badge: "border-sky/40 bg-sky/15 text-sky",
      whyColor: "text-sky/70",
      label: "SAY",
    },
  };

  // The most recent LIVE cue stands out with a brighter, type-coloured border
  // so a freshly-arrived suggestion is easy to catch mid-conversation.
  const newestLiveId = suggestions.reduce(
    (max, s) => (s.kind === "live" && s.id > max ? s.id : max),
    -1
  );

  const renderCard = (s: Suggestion, compact = false) => {
    const meta = TYPE_META[cueType(s)];
    const fresh = s.kind === "live" && s.id === newestLiveId;
    return (
      <div
        key={s.id}
        className={`overflow-hidden rounded-xl border bg-ink/40 ${
          fresh ? meta.borderBright : meta.border
        }`}
      >
        <div className={`flex items-center justify-between ${compact ? "px-3 pt-2" : "px-4 pt-3"}`}>
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
          <div className={`${compact ? "px-3 pb-2.5 pt-1.5" : "px-4 pb-4 pt-2"}`}>
            <span className={`thinking font-display ${compact ? "text-sm" : "text-lg"}`}>
              reading the room...
            </span>
          </div>
        ) : (
          <>
            <div className={`${compact ? "px-3 pb-2.5 pt-1.5" : "px-4 pb-4 pt-2"}`}>
              <p className={`font-display font-medium leading-snug text-bone ${compact ? "text-[0.95rem]" : "text-[1.45rem]"}`}>
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
            {!compact && s.followup && (
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
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.55rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach
        </h1>
        <div className="flex items-center gap-3">
          {cost && (
            <CostMeter
              cost={cost}
              overBudget={overBudget}
              transportLabel={source === "meet" ? "Recall.ai" : "LiveKit"}
              projectedHourly={
                callLive && callStartedAtRef.current
                  ? projectHourlyGBP(
                      cost.totalGBP,
                      (Date.now() - callStartedAtRef.current) / 1000
                    )
                  : estimateCost(3600, 25, {
                      knowledgeTokens: knowledgeTokensFromText(
                        knowledgeRef.current
                      ),
                      deepgramStreams: source === "meet" ? 0 : 2,
                      transport: source === "meet" ? "recall" : "livekit",
                      sonnetCalls: 1,
                    }).totalGBP
              }
            />
          )}
          {status && (
            <span className="rounded-full border border-edge bg-ink/60 px-4 py-2 font-mono text-xs lowercase tracking-wide text-muted">
              {status}
            </span>
          )}
        </div>
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
        <div className="mx-auto mb-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-edge bg-panel/60">
          {callLive && (
            <button
              type="button"
              onClick={() => setExpandSetup(false)}
              className="flex w-full items-center justify-end gap-2 border-b border-edge bg-ink/40 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:text-bone"
            >
              {"\u25BE"} collapse setup
            </button>
          )}
        <div className="grid md:grid-cols-2">
          {/* LEFT - stepped setup */}
          <div className="flex flex-col border-edge md:border-r">
            {/* STEP 1 - Intent */}
            <div className="border-b border-edge px-5 py-3.5">
              <div className="mb-2 flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber font-mono text-[0.6rem] text-amber">
                  1
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-bone">
                  Intent
                </span>
                <span className="ml-auto">
                  <VoiceNoteButton onText={appendBrief} />
                </span>
              </div>
              <textarea
                ref={briefRef}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={7}
                placeholder="e.g. Met Steve at a wedding - he runs a finance business and wants help building software. I want to understand his needs, whether he's a serious buyer, and what kind of system fits."
                className="max-h-[40vh] min-h-[9rem] w-full resize-y overflow-y-auto rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
              />
              <p className="mt-1.5 font-mono text-[0.62rem] leading-relaxed text-muted">
                The one thing that drives everything - the read, the cues, the
                score. It also tells LiveCoach what kind of call this is.
              </p>
            </div>

            {/* STEP 2 - Who & context */}
            <div className="border-b border-edge px-5 py-3.5">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber font-mono text-[0.6rem] text-amber">
                  2
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-bone">
                  Who &amp; context
                </span>
                <span className="ml-auto font-mono text-[0.58rem] text-muted">
                  optional - sharpens the plan
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted">
                      Name
                    </span>
                    <input
                      value={candidate}
                      placeholder="if you have one"
                      onChange={(e) => setCandidate(e.target.value)}
                      className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted">
                      Role / title
                    </span>
                    <input
                      value={role}
                      placeholder="e.g. Founder"
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
                    />
                  </label>
                </div>
                <div>
                  <span className="mb-1.5 block font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted">
                    Public link - website or public profile
                  </span>
                  <div className="flex gap-2">
                    <input
                      value={publicLink}
                      placeholder="https://theircompany.com"
                      onChange={(e) => setPublicLink(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-sky/60"
                    />
                    <button
                      type="button"
                      onClick={research}
                      disabled={researching || !publicLink.trim()}
                      className="shrink-0 rounded-lg border border-sky/50 bg-sky/10 px-4 font-mono text-[0.62rem] uppercase tracking-wider text-sky transition hover:bg-sky/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {researching ? "reading..." : "Research"}
                    </button>
                  </div>
                  {researchNote && (
                    <p className="mt-1.5 font-mono text-[0.6rem] leading-relaxed text-sky/90">
                      {researchNote}
                    </p>
                  )}
                  <p className="mt-1.5 font-mono text-[0.6rem] leading-relaxed text-muted">
                    Public pages only - a company site, an about page. LiveCoach
                    reads it and folds the background into your plan.
                  </p>
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
            </div>

            {/* STEP 3 - Call source */}
            <div className="px-5 py-3.5">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber font-mono text-[0.6rem] text-amber">
                  3
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-bone">
                  Call source
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSource("inapp")}
                  className={`flex-1 rounded-lg border px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wider transition ${
                    source === "inapp"
                      ? "border-amber bg-amber/15 text-amber"
                      : "border-edge text-muted hover:text-bone"
                  }`}
                >
                  In-app link / bot
                </button>
                <button
                  type="button"
                  onClick={() => setSource("meet")}
                  className={`flex-1 rounded-lg border px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wider transition ${
                    source === "meet"
                      ? "border-amber bg-amber/15 text-amber"
                      : "border-edge text-muted hover:text-bone"
                  }`}
                >
                  Meet / Teams / Zoom
                </button>
              </div>
              {source === "inapp" ? (
                <div className="mt-3 flex flex-col gap-2.5">
                  <div>
                    <p className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-amber">
                      Send this join link
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-xs text-bone">
                        {joinLink || "preparing..."}
                      </code>
                      <button
                        onClick={copy}
                        disabled={!joinLink}
                        className="shrink-0 rounded-full border border-amber/50 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/10 disabled:opacity-40"
                      >
                        {copied ? "copied" : "copy"}
                      </button>
                    </div>
                  </div>
                  <a
                    href={botLink || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block self-start rounded-full border border-sage/50 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sage transition hover:bg-sage/10"
                  >
                    Open practice bot (same room)
                  </a>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-amber">
                    Meeting link
                  </p>
                  <input
                    value={meetingUrl}
                    onChange={(e) => setMeetingUrl(e.target.value)}
                    placeholder="Paste Meet / Teams / Zoom link"
                    className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
                  />
                  <p className="font-mono text-[0.6rem] leading-relaxed text-muted">
                    Paste it here, then hit Start call and Send bot - the
                    transcript flows in automatically and cues, summary and
                    scoring run exactly as an in-app call.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT - the generated plan */}
          <div className="relative flex flex-col gap-3 px-5 py-4">
            {prepping ? (
              <MatrixRain
                messages={[
                  "reading the brief",
                  "folding in the document",
                  "shaping the approach",
                  "ranking focus areas",
                  "writing the playbook",
                ]}
              />
            ) : suggestedComps.length === 0 && !character && !background ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-edge p-6 text-center">
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-bone">
                  Your plan appears here
                </p>
                <p className="mt-1.5 max-w-[15rem] font-mono text-[0.62rem] leading-relaxed text-muted/70">
                  Write the intent (and optionally a link), then Build plan -
                  you'll get the background, a read on them, ranked focus, and a
                  tailored playbook.
                </p>
              </div>
            ) : (
              <>
                {callType && callType !== "general" && (
                  <span className="self-start rounded-full border border-amber px-3 py-1 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-amber">
                    {"\u25CF"} {callType} call
                  </span>
                )}
                {background && (
                  <div className="rounded-xl border border-sky/40 bg-sky/[0.06] p-3.5">
                    <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sky">
                      Background
                    </p>
                    <p className="font-sans text-sm leading-relaxed text-bone/85">
                      {background}
                    </p>
                  </div>
                )}
                {character && (
                  <div className="rounded-xl border border-sage/40 bg-sage/[0.06] p-3.5">
                    <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sage">
                      Your read on them
                    </p>
                    <p className="font-sans text-sm leading-relaxed text-bone/85">
                      {character}
                    </p>
                  </div>
                )}
                {suggestedComps.length > 0 && (
                  <div>
                    <p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-amber">
                      Focus <span className="text-muted">- priority order</span>
                    </p>
                    <p className="mb-3 font-mono text-[0.58rem] leading-relaxed text-muted">
                      Drag or arrows to rank. Delete with{" "}
                      <span className="text-rust">{"\u00D7"}</span>, or add your
                      own. Mark one <span className="text-sage">covered</span>{" "}
                      when satisfied - still scored, re-activate any time.
                      Rebuilding won't touch this list.
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
                {playbook.length > 0 && (
                  <div className="rounded-xl border border-edge bg-panel2/40 p-3.5">
                    <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-amber">
                      Playbook{" "}
                      <span className="text-muted">- tailored to this call</span>
                    </p>
                    <ul className="flex flex-col gap-2">
                      {playbook.map((p, i) => (
                        <li
                          key={i}
                          className="font-sans text-[0.82rem] leading-snug text-bone/85"
                        >
                          <span className="text-bone">{p.label}:</span>{" "}
                          {p.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {privateNotes.length > 0 && (
                  <div className="rounded-xl border border-dashed border-rust/50 bg-rust/[0.05] p-3.5">
                    <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-rust">
                      {"\u2691"} Keep in mind{" "}
                      <span className="text-muted">- private, do NOT raise on the call</span>
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {privateNotes.map((n, i) => (
                        <li
                          key={i}
                          className="font-sans text-[0.8rem] leading-snug text-bone/80"
                        >
                          {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ACTION BAR - the build gate */}
        <div className="flex flex-col items-start gap-3 border-t border-edge bg-ink/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[0.63rem] leading-relaxed text-muted">
            {suggestedComps.length > 0
              ? "Plan built. Rank your focus, then Start call. Rebuild refreshes the read, background + playbook - your focus stays."
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
                : "Build plan"}
            </button>
            {suggestedComps.length > 0 && (
              <button
                onClick={() => {
                  persistSession();
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

      {/* call source + join link now live inside setup step 3 above */}

      {callLive && suggestedComps.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-edge bg-panel/50 px-4 py-3">
          <input
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            placeholder="subject name"
            title="Fix the subject's name - the AI uses this spelling in cues, summary and report even if it was mis-heard"
            className="w-32 shrink-0 rounded-lg border border-edge bg-ink/60 px-2.5 py-1 font-mono text-[0.62rem] text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
          />
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
          <button
            type="button"
            onClick={() => setInsightsOn((v) => !v)}
            title="Smart 'say this' insights (Sonnet, ~1 call/30s). Toggle off to save cost on calls that don't need it."
            className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[0.55rem] uppercase tracking-wider transition ${
              insightsOn
                ? "border-sky/50 bg-sky/10 text-sky"
                : "border-edge text-muted hover:text-bone"
            }`}
          >
            {insightsOn ? "insights on" : "insights off"}
          </button>
          <CostMeter
            cost={cost}
            overBudget={overBudget}
            transportLabel={source === "meet" ? "Recall.ai" : "LiveKit"}
            projectedHourly={
              cost && callStartedAtRef.current
                ? projectHourlyGBP(
                    cost.totalGBP,
                    (Date.now() - callStartedAtRef.current) / 1000
                  )
                : 0
            }
          />
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
        {source === "meet" ? (
          <MeetStage
            room={room}
            onFinalTranscript={onFinalTranscript}
            onCandidateTurnEnd={handleCandidateTurnEnd}
            meetingUrl={meetingUrl}
            onMeetingUrlChange={setMeetingUrl}
          />
        ) : (
          <CallStage
            room={room}
            identity="Interviewer"
            role="interviewer"
            onFinalTranscript={onFinalTranscript}
            onCandidateTurnEnd={handleCandidateTurnEnd}
          />
        )}
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

      <div className={`grid gap-6 ${rightMin ? "" : "lg:grid-cols-2"}`}>
        {!rightMin && (
          <section className="flex min-h-[72vh] flex-col rounded-2xl border border-edge bg-panel/50 lg:order-2">
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
                onClick={endAndSummarise}
                disabled={summarising}
                title="End the call and build the scorecard"
                className="ml-auto px-4 py-3 font-mono text-[0.62rem] uppercase tracking-[0.15em] text-rust transition hover:text-bone disabled:opacity-40"
              >
                {summarising ? "ending\u2026" : "End session"}
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
                          ? l.speaker || personLabel
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

        <section className="flex min-h-[72vh] flex-col rounded-2xl border border-amber/40 bg-gradient-to-b from-amber/[0.07] to-transparent lg:order-1">
          <div className="flex items-start justify-between gap-3 border-b border-edge px-6 py-3.5">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-amber">
                Ask this next
              </h2>
              <p className="mt-1 font-mono text-[0.58rem] tracking-wide text-muted">
                {"\u2606"} favourite a cue to keep it in the Bulletin
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCueFull(true)}
              title="Expand cues to full screen (wall of cues)"
              className="shrink-0 rounded-full border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-bone transition hover:border-amber/60"
            >
              {"\u2922"} Expand
            </button>
          </div>

          {pinned.length > 0 && (
            <div className="border-b border-edge/60 px-5 py-4">
              <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-amber/70">
                Bulletin
              </p>
              <div className="flex flex-col gap-2">{pinned.map((s) => renderCard(s))}</div>
            </div>
          )}

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
            {feed.length === 0 ? (
              <p className="font-mono text-sm text-muted">
                Upload a CV + set a role for opening questions. Live cues appear
                as the candidate answers.
              </p>
            ) : (
              feed.map((s) => renderCard(s))
            )}
          </div>
        </section>
      </div>

      {cueFull && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink">
          <div className="flex items-center justify-between border-b border-edge px-6 py-4">
            <div className="flex items-baseline gap-4">
              <h2 className="font-mono text-sm uppercase tracking-[0.25em] text-amber">
                Live cues
              </h2>
              <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                {pinned.length + feed.length} on screen
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCueFull(false)}
              className="rounded-full border border-rust px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
            >
              Exit full screen
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {pinned.length + feed.length === 0 ? (
              <p className="font-mono text-sm text-muted">
                Live cues appear here as the conversation flows.
              </p>
            ) : (
              <div
                className="grid gap-2.5"
                style={{
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                }}
              >
                {[...pinned, ...feed].map((s) => renderCard(s, true))}
              </div>
            )}
          </div>
        </div>
      )}

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
