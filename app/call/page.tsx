"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CallStage from "@/components/CallStage";
import MeetStage from "@/components/MeetStage";
import KnowledgePanel from "@/components/KnowledgePanel";
import VoiceNoteButton from "@/components/VoiceNoteButton";
import SortableFocusList from "@/components/SortableFocusList";
import PostCallSummary from "@/components/PostCallSummary";
import CostMeter from "@/components/CostMeter";
import MatrixRain from "@/components/MatrixRain";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";
import GlobalAssistant from "@/components/crm/GlobalAssistant";
import NavMenu from "@/components/crm/NavMenu";
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
  liked?: boolean;
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
    const direct = res.headers.get("x-cost-usd");
    if (direct) {
      ref.current += parseFloat(direct) || 0;
      return;
    }
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
  const router = useRouter();
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
  // True once the call has been ended + summarised: freezes the meter and
  // unmounts the transcription stage so nothing keeps running or billing.
  const [ended, setEnded] = useState(false);
  const [source, setSource] = useState<"inapp" | "meet">("inapp");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [expandSetup, setExpandSetup] = useState(false);
  // When true, the full authoring setup is shown even at the brief stage (the
  // user clicked "edit setup" from the condensed strip).
  const [briefSetupOpen, setBriefSetupOpen] = useState(false);
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
  const [planStage, setPlanStage] = useState<"none" | "focus" | "full">("none");
  // No-transcriber recap: when the bot can't join the call, the user speaks or
  // types what happened and we summarise from that instead of a live transcript.
  const [manualRecap, setManualRecap] = useState(false);
  const [recapText, setRecapText] = useState("");
  const [recapListening, setRecapListening] = useState(false);
  const recapRecRef = useRef<any>(null);
  const recapBaseRef = useRef("");
  const recapTextRef = useRef("");
  useEffect(() => {
    recapTextRef.current = recapText;
  }, [recapText]);
  // Dictate the recap. Toggles the browser recogniser; appends onto whatever is
  // already in the box. Stable (reads the current text from a ref).
  const toggleRecapMic = useCallback(() => {
    const SR =
      typeof window !== "undefined"
        ? (window as any).webkitSpeechRecognition ||
          (window as any).SpeechRecognition
        : null;
    if (!SR) {
      alert("Voice input needs a Chromium browser (Chrome, Edge, Arc).");
      return;
    }
    if (recapRecRef.current) {
      try {
        recapRecRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    const rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    recapBaseRef.current = recapTextRef.current.trim()
      ? `${recapTextRef.current.trim()} `
      : "";
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setRecapText((recapBaseRef.current + finalText + interim).trim());
    };
    rec.onend = () => {
      setRecapListening(false);
      recapRecRef.current = null;
    };
    rec.onerror = () => setRecapListening(false);
    recapRecRef.current = rec;
    setRecapListening(true);
    rec.start();
  }, []);
  // Opening the recap popup starts the mic straight away; closing stops it.
  useEffect(() => {
    if (manualRecap && !recapRecRef.current) {
      const t = setTimeout(() => toggleRecapMic(), 300);
      return () => clearTimeout(t);
    }
    if (!manualRecap && recapRecRef.current) {
      try {
        recapRecRef.current.stop();
      } catch {
        /* ignore */
      }
    }
  }, [manualRecap, toggleRecapMic]);
  const [docsReady, setDocsReady] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const [status, setStatus] = useState("");
  const [loadedDocs, setLoadedDocs] = useState<string[]>([]);
  // Raised when a document is uploaded AFTER the focus was built, so the user
  // can fold it in. Cleared whenever the focus is (re)built.
  const [newDocFlag, setNewDocFlag] = useState(false);
  // CRM link: the company this call is attached to (its history feeds the plan
  // later, and its scorecard rolls up under the company).
  const [linkedCompany, setLinkedCompany] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // The linked client's email summary, shown on the prep screen so intent and
  // focus are built from the latest of the thread. Saved back to the client.
  const [clientEmailCtx, setClientEmailCtx] = useState("");
  const [emailCtxSaving, setEmailCtxSaving] = useState(false);
  const [emailCtxSaved, setEmailCtxSaved] = useState(false);
  const [suggestedComps, setSuggestedComps] = useState<string[]>([]);
  const [selectedComps, setSelectedComps] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [summarising, setSummarising] = useState(false);
  const [summaryTranscript, setSummaryTranscript] = useState("");
  const [playbook, setPlaybook] = useState<{ label: string; detail: string }[]>([]);
  const [privateNotes, setPrivateNotes] = useState<string[]>([]);
  const [goals, setGoals] = useState<{ text: string; liked?: boolean }[]>([]);
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
  const likedRef = useRef<{ text: string; why: string; kind: string }[]>([]);
  const dislikedRef = useRef<{ text: string; why: string; kind: string }[]>([]);
  const callStartedAtRef = useRef(0);
  const costTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callEndedAtRef = useRef<number | null>(null);
  const sonnetCallsRef = useRef(0);
  const callLiveRef = useRef(false);
  // Holds the latest goLive() so the transcript funnel (stable, no deps) can
  // auto-start the call on first real speech without a stale closure.
  const goLiveRef = useRef<() => void>(() => {});
  const sourceRef = useRef<"inapp" | "meet">("inapp");
  const backgroundRef = useRef("");
  const callTypeRef = useRef("general");
  const roleRef = useRef("");
  const personLabelRef = useRef("Them");
  const candidateRef = useRef("");
  const selectedCompsRef = useRef<string[]>([]);
  const suggestedCompsRef = useRef<string[]>([]);
  // Document-count bookkeeping for the "new document" prompt: how many docs
  // were loaded when the focus was last built vs how many are loaded now.
  const docsAtFocusRef = useRef(0);
  const loadedDocsCountRef = useRef(0);
  // Mirrors of the plan's goals + private notes so the live cue lanes (stable
  // callbacks driven by refs) can feed them to the model without stale state.
  const goalsRef = useRef<{ text: string; liked?: boolean }[]>([]);
  const privateNotesRef = useRef<string[]>([]);
  const linkedCompanyRef = useRef<{ id: string; name: string } | null>(null);
  // Scheduled-call link. When the call screen is opened from an Upcoming call
  // (?upcoming=<id>), the prep plan built here is auto-saved against that row and
  // reloaded next time, so prepping in advance survives leaving the page.
  const upcomingIdRef = useRef<string | null>(null);
  const lastPrepSigRef = useRef("");
  // Guards the auto-save from firing (and clobbering a saved plan with empty
  // initial state) before any reload of an existing plan has finished.
  const prepHydratedRef = useRef(false);
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
      // While live, count transcription time up to now. Once the call has
      // ended, freeze at the end time so the meter stops climbing (it never
      // resets to zero - the accrued cost is preserved).
      const start = callStartedAtRef.current;
      const until = callLiveRef.current ? Date.now() : callEndedAtRef.current || 0;
      const transcribing =
        start && until ? Math.max(0, (until - start) / 1000) : 0;
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
    goalsRef.current = goals;
  }, [goals]);
  useEffect(() => {
    privateNotesRef.current = privateNotes;
  }, [privateNotes]);
  useEffect(() => {
    linkedCompanyRef.current = linkedCompany;
  }, [linkedCompany]);

  // Load the linked client's email summary onto the prep screen.
  useEffect(() => {
    const id = linkedCompany?.id;
    if (!id) {
      setClientEmailCtx("");
      return;
    }
    fetch(`/api/crm/companies/${id}`)
      .then((r) => r.json())
      .then((d) => setClientEmailCtx(d?.company?.email_context || ""))
      .catch(() => {});
  }, [linkedCompany?.id]);

  // Save the email summary back to the client so the planner reads the latest.
  const saveClientEmailCtx = async () => {
    const id = linkedCompanyRef.current?.id;
    if (!id) return;
    setEmailCtxSaving(true);
    try {
      await fetch(`/api/crm/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_context: clientEmailCtx }),
      });
      setEmailCtxSaved(true);
      setTimeout(() => setEmailCtxSaved(false), 2500);
    } catch {
      /* ignore */
    } finally {
      setEmailCtxSaving(false);
    }
  };

  // Best-effort: stamp the linked company onto this session's row. Idempotent -
  // safe to call when linking, at go-live, and at end (the session row exists by
  // then). Never blocks the call.
  const linkSession = useCallback(() => {
    fetch("/api/crm/link-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: room,
        companyId: linkedCompanyRef.current?.id || null,
        contactId: null,
      }),
    }).catch(() => {});
  }, [room]);

  const handleLinkCompany = useCallback(
    (v: { id: string; name: string } | null) => {
      setLinkedCompany(v);
      linkedCompanyRef.current = v;
      linkSession();
    },
    [linkSession]
  );

  // Restore a prep plan that was built in advance for a scheduled call (the prep
  // snapshot stored on the upcoming_calls row), so reopening prep picks up where
  // you left off instead of from a blank slate.
  const hydrateFromPrep = useCallback((prep: any) => {
    if (!prep || typeof prep !== "object") return;
    try {
      if (typeof prep.brief === "string" && prep.brief) setBrief(prep.brief);
      if (typeof prep.role === "string") setRole(prep.role);
      if (typeof prep.callType === "string") setCallType(prep.callType);
      if (typeof prep.candidate === "string" && prep.candidate) {
        setCandidate(prep.candidate);
        candidateRef.current = prep.candidate;
      }
      if (typeof prep.character === "string") setCharacter(prep.character);
      if (Array.isArray(prep.suggestedComps)) {
        const list = prep.suggestedComps.filter(
          (x: any) => typeof x === "string"
        );
        setSuggestedComps(list);
        suggestedCompsRef.current = list;
      }
      if (Array.isArray(prep.selectedComps)) {
        const list = prep.selectedComps.filter(
          (x: any) => typeof x === "string"
        );
        setSelectedComps(list);
        selectedCompsRef.current = list;
      }
      if (Array.isArray(prep.goals)) {
        const g: { text: string; liked?: boolean }[] = [];
        for (const x of prep.goals) {
          if (typeof x === "string" && x.trim()) g.push({ text: x.trim() });
          else if (x && typeof x.text === "string" && x.text.trim())
            g.push({ text: x.text.trim(), liked: !!x.liked });
        }
        setGoals(g);
      }
      if (Array.isArray(prep.playbook)) {
        setPlaybook(
          prep.playbook.filter(
            (p: any) =>
              p && typeof p.label === "string" && typeof p.detail === "string"
          )
        );
      }
      if (Array.isArray(prep.privateNotes)) {
        setPrivateNotes(
          prep.privateNotes.filter((x: any) => typeof x === "string" && x.trim())
        );
      }
      if (Array.isArray(prep.openingQuestions) && prep.openingQuestions.length) {
        const cards: Suggestion[] = prep.openingQuestions.map((item: any) => ({
          id: ++suggestIdRef.current,
          text: typeof item === "string" ? item : item.text || item.q || "",
          why: typeof item === "string" ? "" : item.why || "",
          followup: "",
          at: timeNow(),
          pending: false,
          kind: "opening" as const,
          pinned: false,
        }));
        setSuggestions((prev) => [
          ...prev.filter((s) => s.kind !== "opening"),
          ...cards.reverse(),
        ]);
      }
      if (prep.planStage === "full" || prep.planStage === "focus") {
        setPlanStage(prep.planStage);
      }
      setStatus("loaded your saved prep - pick up where you left off");
    } catch {
      /* ignore a malformed snapshot */
    }
  }, []);

  // Preload from a scheduled (upcoming) call:
  // /call?company=&companyName=&intent=&meetingUrl=&upcoming=  -> link the client,
  // fill the intent, set up the meeting link, and reload any saved prep plan so
  // the user lands ready.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const cid = p.get("company");
    const cname = p.get("companyName");
    const intent = p.get("intent");
    const url = p.get("meetingUrl");
    const upcoming = p.get("upcoming");
    if (cid && cname) handleLinkCompany({ id: cid, name: cname });
    if (intent) setBrief(intent);
    if (url) {
      setMeetingUrl(url);
      setSource("meet");
    }
    if (upcoming) {
      upcomingIdRef.current = upcoming;
      (async () => {
        try {
          const res = await fetch(`/api/crm/upcoming/${upcoming}`);
          if (res.ok) {
            const { call } = await res.json();
            if (call?.company_id && call?.company && !linkedCompanyRef.current) {
              handleLinkCompany({ id: call.company_id, name: call.company });
            }
            hydrateFromPrep(call?.prep);
          }
        } catch {
          /* best-effort reload */
        } finally {
          // Only allow auto-save once any existing plan has been reloaded.
          prepHydratedRef.current = true;
        }
      })();
    } else {
      prepHydratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save the prep plan against the scheduled call it was opened from, so
  // building it in advance survives leaving the page. Debounced, and only while
  // prepping (once the call is live the prep is finalised). Skips saving when
  // nothing has changed.
  useEffect(() => {
    if (!upcomingIdRef.current || !prepHydratedRef.current) return;
    if (callLiveRef.current || planStage === "none") return;
    const openingQuestions = suggestions
      .filter((s) => s.kind === "opening")
      .map((s) => ({ text: s.text, why: s.why }));
    const snapshot = {
      version: 1,
      brief,
      role,
      callType,
      candidate,
      character,
      suggestedComps,
      selectedComps,
      goals,
      playbook,
      privateNotes,
      openingQuestions,
      planStage,
    };
    const sig = JSON.stringify(snapshot);
    if (sig === lastPrepSigRef.current) return;
    const t = setTimeout(() => {
      lastPrepSigRef.current = sig;
      fetch(`/api/crm/upcoming/${upcomingIdRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prep: { ...snapshot, savedAt: new Date().toISOString() },
        }),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [
    brief,
    role,
    callType,
    candidate,
    character,
    suggestedComps,
    selectedComps,
    goals,
    playbook,
    privateNotes,
    planStage,
    suggestions,
  ]);
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
      // Auto-start: the moment real speech is transcribed, the call has in
      // effect begun - so flip to the live cue view automatically (the manual
      // Go live button stays for when you want cues up before anyone speaks).
      // Guarded inside goLive so it only ever fires once.
      if (!callLiveRef.current && text && text.trim().length > 1) {
        goLiveRef.current();
      }
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
          goals: goalsRef.current.map((g) => g.text),
          privateNotes: privateNotesRef.current,
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
          competencies: suggestedCompsRef.current.filter((c) =>
            selectedCompsRef.current.includes(c)
          ),
          goals: goalsRef.current.map((g) => g.text),
          privateNotes: privateNotesRef.current,
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
    // ~20s so ideas flow more readily during brainstorming (was 30s). The
    // advisor itself decides whether there's something worth saying.
    const id = setInterval(() => {
      requestInsight();
    }, 20000);
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
      body: JSON.stringify({
        sessionId: room,
        // Phase 2: if this call is linked to a client, pull their profile + past
        // call history into the plan's context automatically.
        companyId: linkedCompanyRef.current?.id || null,
      }),
    });
    const ctx = await res.json();
    knowledgeRef.current = ctx.context || "";
    const sources = Array.isArray(ctx.sources) ? ctx.sources : [];
    setLoadedDocs(sources);
    loadedDocsCountRef.current = sources.length;
    // If a focus already exists and there are now MORE documents than when it
    // was built, flag it so the user can rebuild the focus to fold them in.
    if (
      suggestedCompsRef.current.length > 0 &&
      sources.length > docsAtFocusRef.current
    ) {
      setNewDocFlag(true);
    }
    return knowledgeRef.current;
  }, [candidate]);

  // Intent-driven plan: brief (top priority) + CV/JD context -> ranked focus
  // areas + character profile + opening questions, in one call.
  const generatePlan = useCallback(async (mode: "focus" | "full" | "refocus") => {
    claudeCallsRef.current += 1;
    const res = await fetch("/api/interview/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: brief || null,
        role: role || null,
        // Only the full build is built AROUND the locked focus. focus/refocus
        // derive a fresh list, so don't pin the existing one.
        focusAreas: mode === "full" ? suggestedCompsRef.current : [],
        focusOnly: mode !== "full",
        // refocus passes the current list so the model reconciles against it
        // (dedupes by meaning + upgrades in place) instead of deriving blind.
        existingFocus:
          mode === "refocus" ? suggestedCompsRef.current : undefined,
        // The name you've corrected is AUTHORITATIVE - send it so the model uses
        // that exact spelling in the focus labels/read instead of the document's.
        subjectName: candidateRef.current || null,
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
    addUsageToRef(claudeUsdRef, res);
    // Be tolerant of a non-JSON body. If the planner is killed by the platform
    // time cap it returns an HTML/text error page ("An error occurred..."),
    // and a raw res.json() would throw "Unexpected token 'A'". Read text first,
    // parse defensively, and surface a clear, actionable message instead.
    const rawBody = await res.text();
    let data: any = {};
    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new Error("the planner ran long - hit build again");
    }
    if (!res.ok) throw new Error(data.error || "Failed to build plan");

    const focus: string[] = Array.isArray(data.focusAreas)
      ? data.focusAreas
      : [];
    let refocusAdded = 0;
    let refocusUpgraded = 0;
    if (mode === "refocus") {
      // Rebuild focus reconciles against the existing list (the route deduped by
      // meaning): apply in-place UPGRADES (a clearly better wording of an
      // existing focus) and APPEND only genuinely new ADDITIONS. Hand-edits and
      // ranking survive; no near-duplicates get tacked on.
      const additions: string[] = Array.isArray(data.additions)
        ? data.additions
            .filter((x: any) => typeof x === "string" && x.trim())
            .map((x: string) => x.trim())
        : [];
      const upgrades: { from: string; to: string }[] = Array.isArray(
        data.upgrades
      )
        ? data.upgrades
            .filter(
              (u: any) =>
                u &&
                typeof u.from === "string" &&
                typeof u.to === "string" &&
                u.from.trim() &&
                u.to.trim()
            )
            .map((u: any) => ({ from: String(u.from).trim(), to: String(u.to).trim() }))
        : [];
      const applyUpgrade = (label: string) => {
        const u = upgrades.find(
          (x) => x.from.toLowerCase().trim() === label.toLowerCase().trim()
        );
        return u ? u.to : label;
      };
      const mergeInto = (prev: string[]) => {
        const upgraded = prev.map(applyUpgrade);
        const have = new Set(upgraded.map((p) => p.toLowerCase().trim()));
        const newOnes = additions.filter(
          (a) => !have.has(a.toLowerCase().trim())
        );
        return [...upgraded, ...newOnes];
      };
      // Fallback for an older route that still returns a flat focusAreas list.
      const legacyMerge = (prev: string[]) => {
        const have = new Set(prev.map((p) => p.toLowerCase().trim()));
        return [...prev, ...focus.filter((f) => !have.has(f.toLowerCase().trim()))];
      };
      const reconciled = data.reconcile === true;
      refocusAdded = reconciled
        ? additions.length
        : focus.filter(
            (f) =>
              !suggestedCompsRef.current
                .map((p) => p.toLowerCase().trim())
                .includes(f.toLowerCase().trim())
          ).length;
      refocusUpgraded = reconciled ? upgrades.length : 0;
      setSuggestedComps((prev) =>
        (reconciled ? mergeInto(prev) : legacyMerge(prev)).slice(0, 12)
      );
      setSelectedComps((prev) =>
        reconciled ? mergeInto(prev) : legacyMerge(prev)
      );
    } else {
      // Lock the focus list once it exists: a regenerate only refreshes the
      // character + opening questions and must NOT touch the focus the user has
      // ranked/edited. Only seed it on the first build.
      setSuggestedComps((prev) => (prev.length > 0 ? prev : focus));
      setSelectedComps((prev) =>
        prev.length > 0 || suggestedCompsRef.current.length > 0 ? prev : focus
      );
    }
    setCharacter(typeof data.character === "string" ? data.character : "");
    if (typeof data.callType === "string") setCallType(data.callType);
    // Whatever is in the name field is AUTHORITATIVE: only seed it from the
    // model when it's still empty. Use the live ref (not the stale closure
    // value) so a name you corrected is never overwritten on a rebuild.
    if (
      typeof data.subjectName === "string" &&
      data.subjectName.trim() &&
      !candidateRef.current.trim()
    ) {
      setCandidate(data.subjectName.trim());
    }

    if (mode === "full") {
      setPlaybook(
        Array.isArray(data.playbook)
          ? data.playbook.filter(
              (p: any) =>
                p && typeof p.label === "string" && typeof p.detail === "string"
            )
          : []
      );
      setPrivateNotes(
        Array.isArray(data.privateNotes)
          ? data.privateNotes.filter(
              (x: any) => typeof x === "string" && x.trim()
            )
          : []
      );
      setGoals(
        Array.isArray(data.goals)
          ? data.goals
              .filter((x: any) => typeof x === "string" && x.trim())
              .map((t: string) => ({ text: t }))
          : []
      );
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
      setSuggestions((prev) => [
        ...prev.filter((s) => s.kind !== "opening"),
        ...[...cards].reverse(),
      ]);
      recentTextsRef.current = [
        ...cards.map((c) => c.text),
        ...recentTextsRef.current,
      ].slice(0, 10);
    }

    // Report whether a real plan came back, and whether it's the generic
    // fallback, so the status line stays honest.
    const ok = focus.length > 0 || suggestedCompsRef.current.length > 0;
    return {
      ok,
      degraded: data.degraded === true,
      added: refocusAdded,
      upgraded: refocusUpgraded,
    };
  }, [brief, role]);


  const prep = useCallback(
    async (mode: "focus" | "full" | "refocus") => {
      setPrepping(true);
      setMeterOn(true);
      setStatus(
        mode === "full"
          ? "building the plan..."
          : mode === "refocus"
          ? "rebuilding focus..."
          : "finding focus..."
      );
      try {
        // Always reload context first so a document uploaded since the last
        // build actually reaches the plan (not just on the initial focus).
        await loadContext();
        const { ok, degraded, added, upgraded } = await generatePlan(mode);
        if (mode === "focus") setPlanStage(ok ? "focus" : "none");
        else if (mode === "full" && ok) setPlanStage("full");
        // refocus keeps the current stage - it only re-derives the focus.
        // The focus now reflects the current documents, so clear the prompt.
        if (mode === "focus" || mode === "refocus") {
          docsAtFocusRef.current = loadedDocsCountRef.current;
          setNewDocFlag(false);
        }
        // Honest, specific status for a rebuild: say what actually changed.
        const refocusMsg = () => {
          const a = added || 0;
          const u = upgraded || 0;
          if (a === 0 && u === 0)
            return "focus already covers the document - nothing new to add";
          const parts: string[] = [];
          if (a > 0) parts.push(`${a} new`);
          if (u > 0) parts.push(`${u} sharpened`);
          return `focus updated (${parts.join(", ")}) - hit Refresh from focus to fold it into the plan`;
        };
        setStatus(
          !ok
            ? "nothing came back - try again"
            : degraded
            ? "generic - edit & rebuild for a tailored plan"
            : mode === "refocus"
            ? refocusMsg()
            : mode === "focus"
            ? "focus ready - rank or delete, then Build the plan"
            : "plan ready"
        );
      } catch (e: any) {
        setStatus(`error: ${e.message || "could not build"}`);
      } finally {
        setPrepping(false);
      }
    },
    [loadContext, generatePlan]
  );

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

  // Single path into the live call - used by BOTH the manual Go live button and
  // the auto-start on first transcript. Guarded so it only ever runs once:
  // persists the session (for scoring) and switches to the cue view.
  const goLive = useCallback(() => {
    if (callLiveRef.current) return;
    persistSession();
    setExpandSetup(false);
    setCallLive(true);
    // Stamp the company link onto the now-created session row. Delayed once so
    // the update lands after persistSession's insert (fire-and-forget order).
    if (linkedCompanyRef.current) {
      linkSession();
      setTimeout(linkSession, 1500);
    }
  }, [persistSession, linkSession]);

  // Keep the ref pointed at the latest goLive so the transcript funnel can call
  // it without taking goLive as a dependency (which would re-create the funnel).
  useEffect(() => {
    goLiveRef.current = goLive;
  }, [goLive]);

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
      // Pull the new document into the call's context right away. loadContext
      // also raises the "new document" prompt if a focus already exists, so the
      // user can fold it in - the doc no longer gets silently ignored.
      loadContext().catch(() => {});
    },
    [loadContext]
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

    const transcriptLabelled = linesRef.current
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
    // In recap mode (bot couldn't join), summarise from what the user said
    // happened instead of a live transcript.
    const labelled =
      manualRecap && recapText.trim() ? recapText.trim() : transcriptLabelled;
    if (labelled.length < 30) {
      setStatus(
        manualRecap
          ? "add a little more to your recap to summarise"
          : "not enough conversation yet to summarise"
      );
      return;
    }
    // End the call NOW. The transcript is already captured in linesRef, so
    // summarising still works - but the live state stops: the cost meter
    // freezes at this moment (no more penny-by-penny ticking) and the
    // transcription stage unmounts so nothing keeps listening or billing.
    callEndedAtRef.current = Date.now();
    callLiveRef.current = false;
    setCallLive(false);
    setEnded(true);
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
      // Make sure the session row carries the company link before we store the
      // scorecard under it.
      if (linkedCompanyRef.current) linkSession();
      // Enrich the call-event row (interview_sessions) with the end time, full
      // transcript and total cost - powers duration / length / participants on
      // the call view. Fire-and-forget: must never block summarising.
      fetch("/api/interview/session-end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: room,
          transcript: labelled,
          totalCost: cost?.totalGBP ?? null,
        }),
      }).catch(() => {});
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
          companyId: linkedCompanyRef.current?.id || null,
          // This call's running cost (GBP) so spend can be totalled over time.
          cost: cost?.totalGBP ?? null,
        }),
      });
      const data = await res.json();
      addUsageToRef(claudeUsdRef, res);
      if (!res.ok) throw new Error(data.error || "Summary failed");
      cachedSummaryRef.current = data.summary;
      cachedSigRef.current = sig;
      setSummary(data.summary);
      setStatus("summary ready");
      // Phase 3: if this call is linked to a client, fold the scorecard into
      // that client's running profile (fire-and-forget, never blocks).
      if (linkedCompanyRef.current && data.summary) {
        fetch("/api/crm/update-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: linkedCompanyRef.current.id,
            summary: data.summary,
            sessionId: room,
            candidate: candidateRef.current || null,
            role: roleRef.current || null,
          }),
        }).catch(() => {});
      }
      // Recap mode: turn what the user said happened into to-dos with actions,
      // so a bot-less call still feeds the to-do list. Fire-and-forget.
      if (manualRecap && recapText.trim() && linkedCompanyRef.current) {
        fetch("/api/crm/extract-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: linkedCompanyRef.current.id,
            text: recapText,
            clientName: candidateRef.current || null,
            source: "recap",
          }),
        })
          .then(() => {
            if (typeof window !== "undefined")
              window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
          })
          .catch(() => {});
      }
    } catch (e: any) {
      setStatus(`error: ${e.message}`);
    } finally {
      setSummarising(false);
    }
  }, [candidate, manualRecap, recapText]);

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

  // Thumbs feedback: up logs a good cue and marks it; down logs it and removes
  // the tile. Banked for the end-of-call debrief and future-call tuning.
  const thumbUp = (sug: Suggestion) => {
    if (!sug.liked)
      likedRef.current = [
        ...likedRef.current,
        { text: sug.text, why: sug.why, kind: sug.kind },
      ];
    setSuggestions((prev) =>
      prev.map((x) => (x.id === sug.id ? { ...x, liked: true } : x))
    );
  };
  const thumbDown = (sug: Suggestion) => {
    dislikedRef.current = [
      ...dislikedRef.current,
      { text: sug.text, why: sug.why, kind: sug.kind },
    ];
    setSuggestions((prev) => prev.filter((x) => x.id !== sug.id));
  };
  const saveFeedback = async (notes: string) => {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: room,
          liked: likedRef.current,
          disliked: dislikedRef.current,
          notes,
        }),
      });
    } catch {
      /* non-blocking */
    }
  };

  const goalThumbUp = (i: number) => {
    const g = goals[i];
    if (g && !g.liked)
      likedRef.current = [
        ...likedRef.current,
        { text: g.text, why: "goal", kind: "goal" },
      ];
    setGoals((prev) =>
      prev.map((x, idx) => (idx === i ? { ...x, liked: true } : x))
    );
  };
  const goalThumbDown = (i: number) => {
    const g = goals[i];
    if (g)
      dislikedRef.current = [
        ...dislikedRef.current,
        { text: g.text, why: "goal", kind: "goal" },
      ];
    setGoals((prev) => prev.filter((_, idx) => idx !== i));
  };

  const ordered = [...lines].reverse();
  const personLabel = candidate.trim() || "Them";
  const pinned = suggestions.filter((s) => s.pinned);
  // Statements (the "SAY" advisor lane) get their own stream so they don't get
  // buried in the question feed. Pinned ones still promote to the Bulletin.
  const ideas = suggestions
    .filter((s) => s.kind === "insight" && !s.pinned)
    .reverse();
  const feed = suggestions
    .filter((s) => !s.pinned && s.kind !== "insight")
    .reverse();
  // The cue engine works down the ranked list, top first; the first active
  // focus (in rank order) is the one currently being served.
  const servingFocus =
    suggestedComps.find((c) => selectedComps.includes(c)) || "";
  const setupCollapsed = callLive && !expandSetup;
  // BRIEF MODE: once the plan is built (and the user hasn't reopened setup to
  // edit), the tall authoring column collapses to a thin strip and the brief
  // takes the full page width in two columns. Reading mode, not typing mode.
  const briefMode = planStage === "full" && !briefSetupOpen;
  // Which of the three stages the user is in, for the header stepper. This must
  // follow the VIEW being shown, not just whether the call is live: going back
  // to setup mid-call (expandSetup) means they're viewing stage 1/2 even though
  // the call is still live in the background.
  const viewingSetup = !callLive || expandSetup;
  const currentStage: 1 | 2 | 3 = !viewingSetup ? 3 : briefMode ? 2 : 1;
  // Click a stage in the stepper to move between them. Going back never ends
  // the call or loses work - it just changes which view is shown.
  const goStage = (n: 1 | 2 | 3) => {
    if (n === 1) {
      // Intent & focus: reveal the full authoring setup.
      if (callLive) setExpandSetup(true);
      setBriefSetupOpen(true);
    } else if (n === 2) {
      // Pre-call brief: only reachable once a plan exists.
      if (planStage !== "full") return;
      if (callLive) setExpandSetup(true);
      setBriefSetupOpen(false);
    } else {
      // Live: go live from setup, or return to the cue view if already live.
      if (planStage !== "full") return;
      if (callLive) setExpandSetup(false);
      else goLive();
    }
  };
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
          {/* Favourite (pin) sits alone in the top corner - well away from the
              thumbs, which live at opposite ends of the footer below. */}
          <button
            onClick={() => togglePin(s.id)}
            className={`shrink-0 rounded-md px-2 py-1 text-lg leading-none transition ${
              s.pinned ? "text-amber" : "text-muted hover:text-amber"
            }`}
            title={s.pinned ? "unpin (favourite)" : "pin (favourite)"}
          >
            {s.pinned ? "\u2605" : "\u2606"}
          </button>
        </div>

        {s.pending && !s.text ? (
          <div className={`${compact ? "px-3 pb-2.5 pt-1.5" : "px-4 pb-4 pt-2"}`}>
            <span className={`thinking font-display ${compact ? "text-lg" : "text-lg"}`}>
              reading the room...
            </span>
          </div>
        ) : (
          <>
            <div className={`${compact ? "px-4 pb-3.5 pt-2" : "px-4 pb-4 pt-2"}`}>
              <p className={`font-display font-medium leading-snug text-bone ${compact ? "text-[1.3rem]" : "text-[1.45rem]"}`}>
                {s.text}
              </p>
              {s.why && (
                <p
                  className={`mt-2.5 font-mono uppercase tracking-[0.18em] ${meta.whyColor} ${compact ? "text-[0.72rem]" : "text-[0.62rem]"}`}
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
            {/* ACTION FOOTER: thumbs pushed to opposite edges (up far-left,
                down far-right) so they can't be mis-tapped for each other. */}
            <div
              className={`flex items-center justify-between border-t border-edge/60 ${
                compact ? "px-2 py-1.5" : "px-2.5 py-2"
              }`}
            >
              <button
                onClick={() => thumbUp(s)}
                title="good cue - log it"
                className={`flex items-center gap-1.5 rounded-lg font-mono uppercase tracking-wider transition ${
                  compact ? "px-2.5 py-1 text-[0.7rem]" : "px-3 py-1.5 text-[0.6rem]"
                } ${
                  s.liked
                    ? "bg-sage/15 text-sage"
                    : "text-muted hover:bg-sage/10 hover:text-sage"
                }`}
              >
                {"\u{1F44D}"}
                {!compact && <span>helpful</span>}
              </button>
              <button
                onClick={() => thumbDown(s)}
                title="not useful - remove & log"
                className={`flex items-center gap-1.5 rounded-lg font-mono uppercase tracking-wider text-muted transition hover:bg-rust/10 hover:text-rust ${
                  compact ? "px-2.5 py-1 text-[0.7rem]" : "px-3 py-1.5 text-[0.6rem]"
                }`}
              >
                {!compact && <span>dismiss</span>}
                {"\u{1F44E}"}
              </button>
            </div>
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

      {/* STAGE STEPPER - always visible, click to move between the three
          stages. Stages 2 and 3 unlock once a plan exists. */}
      <nav
        className={`mb-5 flex items-center gap-1 sm:gap-2 ${
          callLive
            ? "sticky top-0 z-30 -mx-5 border-b border-edge bg-ink/90 px-5 py-2 backdrop-blur"
            : ""
        }`}
      >
        {([
          [1, "Intent & focus"],
          [2, "Pre-call brief"],
          [3, "Live"],
        ] as const).map(([n, label], i) => {
          const reachable = n === 1 || planStage === "full";
          const active = currentStage === n;
          return (
            <span key={n} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && <span className="text-muted/40">{"›"}</span>}
              <button
                type="button"
                onClick={() => goStage(n)}
                disabled={!reachable}
                title={
                  reachable
                    ? `Go to ${label}`
                    : "Build the plan first to unlock this"
                }
                className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] transition ${
                  active
                    ? "bg-amber/15 text-amber"
                    : reachable
                    ? "text-muted hover:bg-bone/[0.05] hover:text-bone"
                    : "cursor-not-allowed text-muted/30"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[0.55rem] ${
                    active ? "bg-amber text-ink" : "bg-bone/10"
                  }`}
                >
                  {n}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            </span>
          );
        })}
      </nav>

      {/* CLIENT LINK - attach this call to a CRM company so its scorecard rolls
          up under that client (and, later, its history feeds the plan). */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-panel/40 px-4 py-2.5">
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted">
          Client
        </span>
        <CompanyLinkPicker value={linkedCompany} onChange={handleLinkCompany} />
        <a
          href="/crm"
          target="_blank"
          rel="noreferrer"
          className="ml-auto font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:text-amber"
        >
          all clients ↗
        </a>
      </div>

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
        {briefSetupOpen && planStage === "full" && !callLive && (
          <button
            type="button"
            onClick={() => setBriefSetupOpen(false)}
            className="flex w-full items-center justify-end gap-2 border-b border-edge bg-ink/40 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            {"▴"} back to brief
          </button>
        )}
        <div className={briefMode ? "" : "grid md:grid-cols-2"}>
          {/* LEFT - stepped setup. Condenses to a one-line strip once the brief
              is built, so the plan can use the full page width. */}
          {briefMode ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-ink/40 px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
                {callType && callType !== "general" && (
                  <span className="text-amber">
                    {"●"} {callType} call
                  </span>
                )}
                {candidate.trim() && (
                  <span className="text-bone/80">{candidate.trim()}</span>
                )}
                <span>
                  {source === "meet" ? "Meet / Teams / Zoom" : "in-app link / bot"}
                </span>
                {loadedDocs.length > 0 && (
                  <span>
                    {loadedDocs.length} doc{loadedDocs.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <button
                onClick={() => setBriefSetupOpen(true)}
                className="shrink-0 rounded-full border border-edge px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
              >
                {"▾"} edit setup
              </button>
            </div>
          ) : (
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

            {/* Email context - the thread so far, where most prep info lives. */}
            {linkedCompany && (
              <div className="border-b border-edge px-5 py-3.5">
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky font-mono text-[0.55rem] text-sky">
                    {"✉"}
                  </span>
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-bone">
                    Email context
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {emailCtxSaved && (
                      <span className="font-mono text-[0.54rem] uppercase tracking-wider text-sage">
                        saved ✓
                      </span>
                    )}
                    <VoiceNoteButton
                      onText={(t) =>
                        setClientEmailCtx((p) =>
                          p.trim() ? `${p.trim()} ${t}` : t
                        )
                      }
                    />
                  </span>
                </div>
                <textarea
                  value={clientEmailCtx}
                  onChange={(e) => setClientEmailCtx(e.target.value)}
                  onBlur={saveClientEmailCtx}
                  rows={5}
                  placeholder="Latest from the email thread - what they've said, where it's up to, what's outstanding. This shapes the focus and intent, and the cues on the call."
                  className="max-h-[36vh] min-h-[6rem] w-full resize-y overflow-y-auto rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-sky/60"
                />
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
                    Saved to the client and fed into the plan - most of your
                    context lives here.
                  </p>
                  <button
                    type="button"
                    onClick={saveClientEmailCtx}
                    disabled={emailCtxSaving}
                    className="shrink-0 rounded-full border border-sky/60 bg-sky/15 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
                  >
                    {emailCtxSaving ? "saving…" : "save"}
                  </button>
                </div>
              </div>
            )}

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
                <div className="mt-3 rounded-lg border border-dashed border-edge bg-ink/30 px-3 py-2.5">
                  <p className="font-mono text-[0.6rem] leading-relaxed text-muted">
                    Paste the meeting link and send the bot in the{" "}
                    <span className="text-amber">Meet / Teams / Zoom</span> panel
                    just below - one place to add the link, send the bot and watch
                    it join. The transcript, cues, summary and scoring then run
                    exactly as an in-app call.
                  </p>
                </div>
              )}
            </div>
          </div>
          )}

          {/* RIGHT - the generated plan (spans full width in brief mode) */}
          <div className="relative flex flex-col gap-3 px-5 py-4">
            {prepping && suggestedComps.length > 0 ? (
              // BUILDING THE PLAN: the focus the user just locked stays pinned
              // at the top while the rest of the brief unfurls beneath it in
              // place (skeletons). No screen swap - the plan grows from the
              // focus on the same surface.
              <>
                <div className="rounded-xl border border-amber/50 bg-amber/[0.08] p-3.5">
                  <p className="mb-2 flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-amber">
                    {"\u{1F512}"} Focus locked
                    <span className="text-muted">- building your plan around it</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedComps.map((c, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-amber/15 px-2.5 py-1 font-mono text-[0.62rem] text-amber/90"
                      >
                        {i + 1} {"\u00B7"} {c}
                      </span>
                    ))}
                  </div>
                </div>
                <MatrixRain
                  messages={[
                    "reading the brief",
                    "folding in the document",
                    "shaping the approach",
                    "writing the playbook",
                    "setting the goals",
                  ]}
                />
              </>
            ) : prepping ? (
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
                  Write the intent (and optionally a link), then Build focus -
                  you'll get the ranked focus to lock in first, then build the
                  full plan around it.
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
                {/* NEW DOCUMENT prompt: a doc was added after the focus was
                    built. Offer to fold it in by rebuilding the focus. */}
                {newDocFlag && suggestedComps.length > 0 && (
                  <div className="flex items-center gap-3 rounded-xl border border-sky/45 bg-sky/[0.08] px-3.5 py-3">
                    <span className="text-base text-sky">{"\u2295"}</span>
                    <p className="flex-1 font-sans text-[0.78rem] leading-snug text-bone/90">
                      <span className="text-sky">New document added</span> - it
                      isn't reflected in your focus yet. Rebuild the focus to fold
                      it in.
                    </p>
                    <button
                      onClick={() => prep("refocus")}
                      disabled={prepping}
                      className="shrink-0 rounded-full border border-sky/60 bg-sky/15 px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
                    >
                      {"\u21BB"} Rebuild focus
                    </button>
                  </div>
                )}
                {/* FOCUS - the spine. Pinned first; once the plan is built it
                    is framed as locked, with the plan unfurled beneath it. */}
                {suggestedComps.length > 0 && (
                  <div
                    className={
                      planStage === "full"
                        ? "rounded-xl border border-amber/50 bg-amber/[0.08] p-3.5"
                        : ""
                    }
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-amber">
                        {planStage === "full" ? (
                          <>
                            {"\u{1F512}"} Focus locked{" "}
                            <span className="text-muted">- plan built around this</span>
                          </>
                        ) : (
                          <>
                            Focus <span className="text-muted">- priority order</span>
                          </>
                        )}
                      </p>
                      <button
                        onClick={() => prep("refocus")}
                        disabled={prepping}
                        title="Re-derive the focus from your intent + documents, keeping your edits"
                        className="shrink-0 rounded-full border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:opacity-40"
                      >
                        {"\u21BB"} Rebuild focus
                      </button>
                    </div>
                    <p className="mb-3 font-mono text-[0.58rem] leading-relaxed text-muted">
                      {planStage === "full"
                        ? "Edit and hit Refresh from focus to re-steer the plan - this list stays exactly as you set it. Rebuild focus re-derives it from your intent + documents and keeps your edits."
                        : "Drag or arrows to rank. Delete with \u00D7, or add your own. Rebuild focus re-derives the list from your intent + documents and keeps anything you've added."}
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
                {/* Brief cards flow into two columns once the plan is built, so
                    they fill the full page width instead of one tall column. */}
                <div
                  className={
                    briefMode
                      ? "gap-3 [&>*]:mb-3 [&>*]:break-inside-avoid md:columns-2"
                      : "flex flex-col gap-3"
                  }
                >
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
                {suggestions.some((s) => s.kind === "opening") && (
                  <div className="rounded-xl border border-edge bg-panel2/40 p-3.5">
                    <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-sky">
                      Opening questions{" "}
                      <span className="text-muted">- ways in</span>
                    </p>
                    <ul className="flex flex-col gap-2">
                      {suggestions
                        .filter((s) => s.kind === "opening")
                        .map((s) => (
                          <li
                            key={s.id}
                            className="font-sans text-[0.82rem] leading-snug text-bone/85"
                          >
                            {s.text}
                            {s.why ? (
                              <span className="text-muted"> {"\u2014"} {s.why}</span>
                            ) : null}
                          </li>
                        ))}
                    </ul>
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
                {goals.length > 0 && (
                  <div className="rounded-xl border border-edge bg-panel2/40 p-3.5">
                    <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-sage">
                      Goals{" "}
                      <span className="text-muted">- what a good call looks like</span>
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {goals.map((g, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 font-sans text-[0.82rem] leading-snug text-bone/85"
                        >
                          <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-sage/70" />
                          {g.text}
                        </li>
                      ))}
                      <p className="mt-1 font-mono text-[0.56rem] leading-relaxed text-muted/70">
                        You tick these off live during the call.
                      </p>
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
                </div>
              </>
            )}
          </div>
        </div>

        {/* ACTION BAR - the build gate */}
        <div className="flex flex-col items-start gap-3 border-t border-edge bg-ink/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[0.63rem] leading-relaxed text-muted">
            {planStage === "none"
              ? "Step 1: build the focus only - fast. Then rank/delete it before we generate the full plan."
              : planStage === "focus"
              ? "Step 2: rank or delete the focus, then Build the plan - the read, questions, playbook & goals are built around your locked focus."
              : "Edit the focus anytime, then Refresh from focus rebuilds the read, questions, playbook & goals around it - your focus list stays as you set it. The call goes live on its own the moment speech is picked up - or hit Go live to bring the cues up first."}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={async () => {
                // Persist the latest email context first so the planner reads it.
                if (linkedCompanyRef.current?.id) await saveClientEmailCtx();
                prep(planStage === "none" ? "focus" : "full");
              }}
              disabled={prepping || (!brief.trim() && !(cvReady && role.trim()))}
              className="rounded-full border border-amber/60 bg-amber/15 px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {prepping
                ? "working..."
                : planStage === "none"
                ? "Build focus"
                : planStage === "focus"
                ? "Build the plan"
                : "Refresh from focus"}
            </button>
            {planStage === "full" && (
              <button
                onClick={goLive}
                className="rounded-full border border-sage/60 bg-sage/15 px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
              >
                Go live {"\u25B8"}
              </button>
            )}
            {planStage === "full" && (
              <button
                type="button"
                onClick={() => setManualRecap(true)}
                title="Bot couldn't join? Record your own recap and I'll summarise it."
                className="rounded-full border border-sky/60 bg-sky/20 px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-sky transition hover:bg-sky/30"
              >
                {"\u2726"} No transcriber? Recap by voice
              </button>
            )}
          </div>

          {manualRecap && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-[640px] rounded-2xl border border-sky/40 bg-panel p-6 shadow-2xl">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-sky">
                    {"\u2726"} Recap this call
                  </p>
                  <button
                    type="button"
                    onClick={() => setManualRecap(false)}
                    className="font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:text-rust"
                  >
                    close
                  </button>
                </div>
                <p className="mb-4 font-mono text-[0.62rem] leading-relaxed text-muted">
                  The mic is on - just say what happened: who was on, what was
                  discussed, the outcome, and what needs doing next. I'll write
                  the summary and turn the next steps into to-dos.
                </p>
                <div className="mb-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleRecapMic}
                    title={recapListening ? "tap to pause" : "tap to record"}
                    className={`flex h-12 w-12 items-center justify-center rounded-full border text-lg transition ${
                      recapListening
                        ? "border-rust bg-rust text-white animate-pulse"
                        : "border-sky/60 bg-sky/15 text-sky hover:bg-sky/25"
                    }`}
                  >
                    {recapListening ? "\u23F9" : "\u{1F3A4}"}
                  </button>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                    {recapListening ? "listening\u2026 tap to pause" : "tap to record"}
                  </span>
                </div>
                <textarea
                  value={recapText}
                  onChange={(e) => setRecapText(e.target.value)}
                  rows={12}
                  placeholder="What happened on the call?\u2026"
                  className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-4 py-3 font-sans text-[0.95rem] leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-sky/60"
                />
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setManualRecap(false)}
                    className="rounded-full border border-edge px-4 py-2 font-mono text-[0.64rem] uppercase tracking-wider text-muted transition hover:text-bone"
                  >
                    cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setManualRecap(false);
                      endAndSummarise();
                    }}
                    disabled={summarising || recapText.trim().length < 20}
                    className="rounded-full border border-sky/60 bg-sky/20 px-5 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider text-sky transition hover:bg-sky/30 disabled:opacity-40"
                  >
                    {summarising ? "summarising\u2026" : `summarise from my recap ${"\u25B8"}`}
                  </button>
                </div>
              </div>
            </div>
          )}
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
        {/* Unmount the transcription stage once the call has ended so the
            socket / mic / bot listener fully stops (no lingering billing). */}
        {!ended &&
          (source === "meet" ? (
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
          ))}
      </div>

      <div className="mb-6 flex justify-center">
        <button
          onClick={endAndSummarise}
          disabled={summarising}
          className="rounded-full border border-amber/50 bg-amber/10 px-7 py-3 font-mono text-sm uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {summarising ? "summarising..." : "End call & summarise"}
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
                  {goals.length > 0 && (
                    <div className="rounded-xl border border-amber/30 bg-amber/[0.05] p-3.5">
                      <p className="mb-2 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
                        Goals for this call
                      </p>
                      <ul className="flex flex-col gap-1.5">
                        {goals.map((g, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2.5 font-sans text-[0.82rem] leading-snug text-bone/85"
                          >
                            <button
                              onClick={() => goalThumbUp(i)}
                              title="good goal"
                              className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[0.8rem] leading-none transition ${
                                g.liked
                                  ? "bg-sage/15 text-sage"
                                  : "text-muted hover:bg-sage/10 hover:text-sage"
                              }`}
                            >
                              {"\u{1F44D}"}
                            </button>
                            <span className="flex-1">{g.text}</span>
                            <button
                              onClick={() => goalThumbDown(i)}
                              title="remove goal"
                              className="mt-px shrink-0 rounded px-1.5 py-0.5 text-[0.8rem] leading-none text-muted transition hover:bg-rust/10 hover:text-rust"
                            >
                              {"\u{1F44E}"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
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

          {/* IDEAS TO ADD - the advisor "SAY" lane, its own visible spot so the
              statements you could make don't get lost among the questions. */}
          {insightsOn && ideas.length > 0 && (
            <div className="border-b border-sky/25 bg-sky/[0.04] px-5 py-4">
              <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-sky/80">
                {"◆"} Ideas to add{" "}
                <span className="text-muted">- things you could say</span>
              </p>
              <div className="flex flex-col gap-2">
                {ideas.slice(0, 3).map((s) => renderCard(s))}
              </div>
            </div>
          )}

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
            {feed.length === 0 ? (
              <p className="font-mono text-sm text-muted">
                Cues and ideas to say stream in here once the conversation gets
                going - your opening questions are ready in the plan.
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
                className="grid gap-3"
                style={{
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
          companyId={linkedCompany?.id}
          liked={likedRef.current}
          disliked={dislikedRef.current}
          onSaveFeedback={saveFeedback}
          onClose={() => {
            // After reading the individual call summary, land somewhere clean
            // and useful rather than the spent live-call screen: the linked
            // client's profile (with its freshly updated overall AI summary),
            // or the dashboard if this call wasn't tied to a client.
            setSummary(null);
            const cid = linkedCompanyRef.current?.id || linkedCompany?.id;
            router.push(cid ? `/crm/${cid}` : "/crm");
          }}
        />
      )}
      <GlobalAssistant
        companyId={linkedCompany?.id}
        companyName={linkedCompany?.name}
      />
      {/* Hide the sidebar while a full-screen overlay is up (the cue wall or the
          end-of-call summary) so nothing pokes through on the left. */}
      {!cueFull && !summary && <NavMenu />}
    </main>
  );
}
