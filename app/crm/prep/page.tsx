"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";

type Call = {
  id: string;
  candidate: string | null;
  role: string | null;
  created_at: string;
  summary: any;
};

type Task = {
  id: string;
  text: string;
  kind: string;
  status: string;
};

type Battlecard = {
  oneLiner: string;
  fit: { strong: string[]; weak: string[] };
  pitch: string;
  flow: { minutes: string; label: string }[];
  objections: { objection: string; response: string; haveReady: string | null }[];
  doNotSay: string[];
  questionsToAsk: string[];
  nextStep: string;
  sources: { title: string; url: string }[];
  generatedAt?: string;
};

type Subject = {
  person: string;
  personEmail: string;
  role: string;
  contactId: string | null;
  companyId: string | null;
  companyName: string;
  website: string;
  internal: boolean;
};

type EntityState = {
  have: boolean;
  fresh: boolean;
  generatedAt: string | null;
  subject: string;
  background: string;
  sources: { title: string; url: string }[];
  ttlDays: number;
};

type StepKey = "company" | "person" | "intent" | "focus" | "plan";
type StepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "failed"
  | "waiting";

type Step = { key: StepKey; label: string; status: StepStatus; note: string };

const STEP_LABELS: { key: StepKey; label: string }[] = [
  { key: "company", label: "Research the company" },
  { key: "person", label: "Research the person" },
  { key: "intent", label: "Build the intent" },
  { key: "focus", label: "Build the focus" },
  { key: "plan", label: "Build the plan" },
];

const freshSteps = (): Step[] =>
  STEP_LABELS.map((s) => ({ ...s, status: "pending" as StepStatus, note: "" }));

const fmtDate = (iso?: string) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const daysAgo = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

const ageLabel = (iso?: string | null): string => {
  const d = daysAgo(iso);
  if (d === null) return "";
  if (d === 0) return "researched today";
  if (d === 1) return "researched yesterday";
  return `researched ${d} days ago`;
};

// Research never expires on its own, so the screen has to be the thing that
// tells you a brief is getting old. Past this many days the age is called out
// so an obviously stale brief does not quietly drive a call.
const STALE_HINT_DAYS = 90;

const staleNote = (iso?: string | null): string => {
  const d = daysAgo(iso);
  return d !== null && d > STALE_HINT_DAYS ? ", may be out of date" : "";
};

const list = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];

function Actions({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: string;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5">
      <p
        className={`mb-1 font-mono text-[0.54rem] uppercase tracking-[0.18em] ${tone}`}
      >
        {title}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((t, i) => (
          <li
            key={i}
            className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The little status glyph on each chain step.
function StepDot({ status }: { status: StepStatus }) {
  if (status === "done")
    return <span className="font-mono text-[0.7rem] text-sage">✓</span>;
  if (status === "skipped")
    return <span className="font-mono text-[0.7rem] text-muted">–</span>;
  if (status === "failed")
    return <span className="font-mono text-[0.7rem] text-rust">✕</span>;
  if (status === "running")
    return (
      <span className="font-mono text-[0.7rem] text-amber motion-safe:animate-pulse">
        ●
      </span>
    );
  if (status === "waiting")
    return <span className="font-mono text-[0.7rem] text-sky">?</span>;
  return <span className="font-mono text-[0.7rem] text-muted/40">○</span>;
}

function PrepInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const companyId = sp.get("company") || "";
  const companyNameParam = sp.get("companyName") || "";
  const upcomingId = sp.get("upcoming") || "";

  const callsUrl = `/api/crm/companies/${companyId}/calls`;
  const tasksUrl = `/api/crm/tasks?companyId=${companyId}`;
  const companyUrl = `/api/crm/companies/${companyId}`;

  const [name, setName] = useState(companyNameParam);
  const [calls, setCalls] = useState<Call[]>(
    getCached<{ calls: Call[] }>(callsUrl)?.calls || []
  );
  const [tasks, setTasks] = useState<Task[]>(
    getCached<{ tasks: Task[] }>(tasksUrl)?.tasks || []
  );
  const [playbook, setPlaybook] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [intent, setIntent] = useState("");
  const [rationale, setRationale] = useState("");
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [savedToCall, setSavedToCall] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllCalls, setShowAllCalls] = useState(false);

  const [battlecard, setBattlecard] = useState<Battlecard | null>(null);
  const [bcBusy, setBcBusy] = useState(false);
  const [bcErr, setBcErr] = useState("");

  // ---- The prep chain ------------------------------------------------------
  const [subject, setSubject] = useState<Subject | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const [emailContext, setEmailContext] = useState("");
  const [companyResearch, setCompanyResearch] = useState<EntityState | null>(
    null
  );
  const [personResearch, setPersonResearch] = useState<EntityState | null>(null);
  const [steps, setSteps] = useState<Step[]>(freshSteps());
  const [chainRunning, setChainRunning] = useState(false);
  const [chainErr, setChainErr] = useState("");
  const [chainDone, setChainDone] = useState(false);
  const [confirmWho, setConfirmWho] = useState<any>(null);
  const [builtFocus, setBuiltFocus] = useState<string[]>([]);
  const [builtQuestions, setBuiltQuestions] = useState<
    { text: string; why: string }[]
  >([]);
  const [builtGoals, setBuiltGoals] = useState<string[]>([]);
  const [openBriefs, setOpenBriefs] = useState(false);
  // How far prep has got. The chain takes you to "intent" and stops. "focus"
  // needs you to press Build the focus, "full" needs Build the plan. Each gate
  // is there because the next stage is built FROM the one before it, so
  // running ahead of your approval means paying for the same step twice.
  const [stage, setStage] = useState<
    "none" | "intent" | "focus" | "full"
  >("none");

  // Live values the chain reads and writes as it walks the steps. Refs, not
  // state, so each step sees what the step before it produced without waiting
  // for a re-render.
  // The running guard is a REF, not the state flag. State updates are async, so
  // a handler that flips the flag and immediately calls the chain would still
  // see the old value and bail out silently.
  const runningRef = useRef(false);
  const bgRef = useRef<{ company: string; person: string }>({
    company: "",
    person: "",
  });
  const intentRef = useRef("");
  const focusRef = useRef<string[]>([]);
  const knowledgeRef = useRef("");

  const setStep = useCallback(
    (key: StepKey, status: StepStatus, note = "") => {
      setSteps((prev) =>
        prev.map((s) => (s.key === key ? { ...s, status, note } : s))
      );
    },
    []
  );

  useEffect(() => {
    if (!companyId) return;
    crmFetch<{ calls: Call[] }>(callsUrl)
      .then((d) => setCalls(d.calls || []))
      .catch(() => {});
    crmFetch<{ tasks: Task[] }>(tasksUrl)
      .then((d) => setTasks(d.tasks || []))
      .catch(() => {});
    crmFetch<{ company: { name: string; profile: any } }>(companyUrl)
      .then((d) => {
        if (d.company?.name) setName(d.company.name);
        const pb = d.company?.profile?.playbook;
        setPlaybook(
          Array.isArray(pb)
            ? pb.filter((p: any) => typeof p === "string" && p.trim())
            : []
        );
        const bc = d.company?.profile?.battlecard;
        if (bc && typeof bc === "object") setBattlecard(bc as Battlecard);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Who is this call with, and what is already researched. Costs nothing.
  const loadSubject = useCallback(async () => {
    const qs = new URLSearchParams();
    if (upcomingId) qs.set("upcomingId", upcomingId);
    if (companyId) qs.set("companyId", companyId);
    try {
      const d = await crmFetch<any>(
        `/api/interview/prep-subject?${qs.toString()}`
      );
      setSubject(d.subject || null);
      setHasHistory(!!d.hasHistory);
      setEmailContext(typeof d.emailContext === "string" ? d.emailContext : "");
      setCompanyResearch(d.company || null);
      setPersonResearch(d.person || null);
      bgRef.current = {
        company: d.company?.background || "",
        person: d.person?.background || "",
      };
      const existingIntent =
        (d.call && typeof d.call.intent === "string" && d.call.intent) || "";
      if (existingIntent) {
        setIntent((prev) => (prev.trim() ? prev : existingIntent));
        intentRef.current = existingIntent;
      }
      // RESUME WHERE YOU LEFT OFF. Anything already built and saved against
      // this call is restored, not rebuilt: reopening the screen must never
      // re-spend on work you have already paid for. Pressing on then only does
      // the steps that are genuinely still missing.
      const saved = (d.call && d.call.prep) || null;
      const savedFocus: string[] = Array.isArray(saved?.selectedComps)
        ? saved.selectedComps.filter((x: any) => typeof x === "string" && x.trim())
        : [];
      const savedStage: string =
        typeof saved?.planStage === "string" ? saved.planStage : "";

      if (savedFocus.length) {
        focusRef.current = savedFocus;
        setBuiltFocus(savedFocus);
      }
      if (savedStage === "full") {
        setBuiltQuestions(
          Array.isArray(saved.openingQuestions)
            ? saved.openingQuestions
                .map((q: any) => ({
                  text: typeof q === "string" ? q : q?.text || q?.q || "",
                  why: typeof q === "string" ? "" : q?.why || "",
                }))
                .filter((q: any) => q.text)
            : []
        );
        setBuiltGoals(
          Array.isArray(saved.goals)
            ? saved.goals
                .map((g: any) => (typeof g === "string" ? g : g?.text || ""))
                .filter(Boolean)
            : []
        );
        setStage("full");
      } else if (savedFocus.length) {
        setStage("focus");
      } else if (existingIntent) {
        setStage("intent");
      }

      // Pre-tick anything already on file so the checklist is honest before you
      // press anything.
      setSteps((prev) =>
        prev.map((s) => {
          if (s.key === "company" && d.company?.have && d.company?.fresh)
            return {
              ...s,
              status: "done" as StepStatus,
              note: `on file, ${ageLabel(d.company.generatedAt)}${staleNote(
                d.company.generatedAt
              )}`,
            };
          if (s.key === "person" && d.person?.have && d.person?.fresh)
            return {
              ...s,
              status: "done" as StepStatus,
              note: `on file, ${ageLabel(d.person.generatedAt)}${staleNote(
                d.person.generatedAt
              )}`,
            };
          if (s.key === "intent" && existingIntent)
            return {
              ...s,
              status: "done" as StepStatus,
              note: "already set, yours is kept",
            };
          if (s.key === "focus" && savedFocus.length)
            return {
              ...s,
              status: "done" as StepStatus,
              note: `${savedFocus.length} focus areas, saved`,
            };
          if (s.key === "plan" && savedStage === "full")
            return { ...s, status: "done" as StepStatus, note: "saved to this call" };
          return s;
        })
      );
    } catch {
      /* the chain can still run, it just cannot pre-tick anything */
    }
  }, [upcomingId, companyId]);

  useEffect(() => {
    loadSubject();
  }, [loadSubject]);

  const mergedBackground = useCallback(() => {
    const parts: string[] = [];
    if (bgRef.current.person)
      parts.push(`PERSON BRIEF\n${bgRef.current.person}`);
    if (bgRef.current.company)
      parts.push(`COMPANY BACKGROUND\n${bgRef.current.company}`);
    return parts.join("\n\n");
  }, []);

  // The context the planner reads: the client's CRM history (which already
  // carries the email thread and the battle plan), plus the fresh research.
  const buildKnowledge = useCallback(async () => {
    let block = "";
    try {
      const res = await fetch("/api/interview/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: upcomingId || null,
          companyId: companyId || null,
        }),
      });
      const d = await res.json();
      if (res.ok && typeof d.context === "string") block = d.context;
    } catch {
      /* best effort, the plan can still build from the intent */
    }
    const bg = mergedBackground();
    // The company history block already contains the email thread. Only add it
    // separately when there is no linked client to have carried it.
    const email =
      !companyId && emailContext.trim()
        ? `EMAIL CONTEXT, the thread with this client so far, treat as primary substance:\n${emailContext.trim()}`
        : "";
    knowledgeRef.current = [
      block,
      bg ? `RESEARCH, about the person and their company:\n${bg}` : "",
      email,
    ]
      .filter(Boolean)
      .join("\n\n");
    return knowledgeRef.current;
  }, [companyId, upcomingId, emailContext, mergedBackground]);

  // Save prep against the scheduled call in EXACTLY the shape the call screen
  // already reloads, so opening the call lands ready. Called twice: once when
  // the focus lands (so leaving the page does not lose it) and again with the
  // full plan.
  const saveSnapshot = useCallback(
    async (opts: {
      focus: string[];
      stage: "focus" | "full";
      plan?: any;
      questions?: { text: string; why: string }[];
      goals?: string[];
    }) => {
      if (!upcomingId) return;
      const p = opts.plan || {};
      const snapshot = {
        version: 1,
        brief: intentRef.current,
        role: subject?.role || "",
        callType: typeof p.callType === "string" ? p.callType : "general",
        candidate:
          (typeof p.subjectName === "string" && p.subjectName) ||
          subject?.person ||
          "",
        character: typeof p.character === "string" ? p.character : "",
        suggestedComps: opts.focus,
        selectedComps: opts.focus,
        goals: (opts.goals || []).map((t) => ({ text: t })),
        playbook: Array.isArray(p.playbook)
          ? p.playbook.filter(
              (x: any) =>
                x && typeof x.label === "string" && typeof x.detail === "string"
            )
          : [],
        pitchKit: p.pitchKit || null,
        privateNotes: list(p.privateNotes),
        openingQuestions: opts.questions || [],
        planStage: opts.stage,
        savedAt: new Date().toISOString(),
      };
      // NO .catch here on purpose. crmFetch throws on a non-OK response, and
      // swallowing that meant a failed save still reported "saved to this
      // call" while the plan you just paid for quietly vanished. Let it throw
      // so the caller can mark the step failed and you know to press again.
      await crmFetch(`/api/crm/upcoming/${upcomingId}`, {
        method: "PATCH",
        // Saving marks the call prepped, so the Upcoming list shows it solid.
        body: JSON.stringify({ prep: snapshot, prepped: opts.stage === "full" }),
      });
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    },
    [upcomingId, subject]
  );

  // ---- The chain itself ----------------------------------------------------
  // Steps run in order and each one feeds the next. Anything already cached and
  // fresh is skipped, so research is bought once per entity, not once per call.
  // `from` lets the chain resume after you confirm who the person is.
  const runChain = useCallback(
    async (from: number, identity?: any) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setChainRunning(true);
      setChainErr("");
      setChainDone(false);
      setConfirmWho(null);

      const s = subject;
      const person = s?.person || "";
      const coName = s?.companyName || name || "";

      try {
        // 1. COMPANY -------------------------------------------------------
        if (from <= 0) {
          if (!coName && !s?.website) {
            setStep("company", "skipped", "no company on this call");
          } else {
            setStep("company", "running", "searching the open web");
            const d = await crmFetch<any>("/api/interview/research-entity", {
              method: "POST",
              body: JSON.stringify({
                mode: "company",
                upcomingId: upcomingId || undefined,
                companyId: companyId || undefined,
                company: coName || undefined,
                website: s?.website || undefined,
                intent: intentRef.current || undefined,
              }),
            });
            if (d.skipped) setStep("company", "skipped", d.reason || "");
            else if (d.error) setStep("company", "failed", d.error);
            else {
              bgRef.current.company = d.background || "";
              setCompanyResearch({
                have: true,
                fresh: true,
                generatedAt: d.generatedAt,
                subject: d.subject || coName,
                background: d.background || "",
                sources: d.sources || [],
                ttlDays: d.ttlDays ?? 0,
              });
              setStep(
                "company",
                "done",
                d.cached
                  ? `already on file, ${ageLabel(d.generatedAt)}${staleNote(
                      d.generatedAt
                    )}`
                  : "fresh"
              );
            }
          }
        }

        // 2. PERSON --------------------------------------------------------
        if (from <= 1) {
          if (!person && !s?.personEmail) {
            setStep("person", "skipped", "no one named on this call yet");
          } else {
            let id = identity;
            if (!id) {
              setStep("person", "running", "checking who this is");
              const idRes = await crmFetch<any>(
                "/api/interview/research-entity",
                {
                  method: "POST",
                  body: JSON.stringify({
                    mode: "person",
                    stage: "identify",
                    upcomingId: upcomingId || undefined,
                    companyId: companyId || undefined,
                    contactId: s?.contactId || undefined,
                    person: person || undefined,
                    personEmail: s?.personEmail || undefined,
                    role: s?.role || undefined,
                    company: coName || undefined,
                  }),
                }
              );
              if (idRes.decision === "cached") {
                bgRef.current.person = idRes.background || "";
                setPersonResearch({
                  have: true,
                  fresh: true,
                  generatedAt: idRes.generatedAt,
                  subject: idRes.subject || person,
                  background: idRes.background || "",
                  sources: idRes.sources || [],
                  ttlDays: idRes.ttlDays ?? 0,
                });
                setStep(
                  "person",
                  "done",
                  `already on file, ${ageLabel(idRes.generatedAt)}${staleNote(
                    idRes.generatedAt
                  )}`
                );
              } else if (idRes.decision === "confirm") {
                // Medium or low confidence. Stop rather than brief a stranger
                // and let a wrong match poison the intent, focus and plan.
                setConfirmWho(idRes.identity);
                setStep("person", "waiting", "is this the right person?");
                runningRef.current = false;
                setChainRunning(false);
                return;
              } else if (idRes.decision === "auto") {
                id = idRes.identity;
              } else {
                setStep(
                  "person",
                  "skipped",
                  idRes.error || "could not pin down who this is"
                );
              }
            }

            if (id) {
              setStep("person", "running", `briefing ${id.name || person}`);
              const bRes = await crmFetch<any>("/api/interview/research-entity", {
                method: "POST",
                body: JSON.stringify({
                  mode: "person",
                  stage: "brief",
                  upcomingId: upcomingId || undefined,
                  companyId: companyId || undefined,
                  contactId: s?.contactId || undefined,
                  person: person || undefined,
                  personEmail: s?.personEmail || undefined,
                  role: s?.role || undefined,
                  company: coName || undefined,
                  intent: intentRef.current || undefined,
                  identity: id,
                }),
              });
              if (bRes.error) setStep("person", "failed", bRes.error);
              else {
                bgRef.current.person = bRes.background || "";
                setPersonResearch({
                  have: true,
                  fresh: true,
                  generatedAt: bRes.generatedAt,
                  subject: bRes.subject || person,
                  background: bRes.background || "",
                  sources: bRes.sources || [],
                  ttlDays: bRes.ttlDays ?? 0,
                });
                setStep("person", "done", `briefed ${bRes.subject || person}`);
              }
            }
          }
        }

        // 3. INTENT --------------------------------------------------------
        // Your words win. An intent already on the call is never overwritten,
        // there is a re-draft link for when you do want it rebuilt.
        if (intentRef.current.trim()) {
          setStep("intent", "done", "already set, yours is kept");
        } else {
          setStep("intent", "running", "drafting from the research");
          let drafted = "";
          try {
            if (hasHistory && companyId) {
              const d = await crmFetch<any>(
                `/api/crm/companies/${companyId}/prep-intent`,
                { method: "POST", body: JSON.stringify({ concise: true }) }
              );
              drafted = (d.intent || "").trim();
              if (d.rationale) setRationale(d.rationale);
            } else {
              const res = await fetch("/api/interview/first-meeting-intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  company: coName || undefined,
                  person: person || undefined,
                  role: s?.role || undefined,
                  background: mergedBackground() || undefined,
                  emailContext: emailContext || undefined,
                }),
              });
              const d = await res.json();
              if (res.ok) drafted = (d.intent || "").trim();
            }
          } catch (e: any) {
            /* fall through to the failed note below */
          }
          if (drafted) {
            intentRef.current = drafted;
            setIntent(drafted);
            setStep("intent", "done", "drafted, edit it if you want");
            if (upcomingId) {
              crmFetch(`/api/crm/upcoming/${upcomingId}`, {
                method: "PATCH",
                body: JSON.stringify({ intent: drafted }),
              }).catch(() => {});
            }
          } else {
            setStep(
              "intent",
              "failed",
              "could not draft one, write a line yourself and re-run"
            );
          }
        }

        // 4. FOCUS is NOT run here, on purpose.
        //
        // The chain stops at the intent. The focus is built FROM the intent,
        // and the drafted intent is often not quite right, so building the
        // focus in the same press meant reading a focus aimed at the wrong
        // objective, fixing the intent, and paying for the focus twice. Read
        // the intent, fix it if it is off, then press Build the focus.
        if (!focusRef.current.length) {
          setStep("focus", "pending", "check the intent first");
          setStage("intent");
        }
        setChainDone(true);
      } catch (e: any) {
        setChainErr(e?.message || "the prep chain stopped");
        setSteps((prev) =>
          prev.map((x) =>
            x.status === "running"
              ? { ...x, status: "failed" as StepStatus, note: "stopped" }
              : x
          )
        );
      } finally {
        runningRef.current = false;
        setChainRunning(false);
      }
    },
    [
      subject,
      name,
      companyId,
      upcomingId,
      hasHistory,
      emailContext,
      setStep,
      buildKnowledge,
      mergedBackground,
      saveSnapshot,
    ]
  );

  // Pressing the top button runs research and the intent. It deliberately does
  // NOT clear a focus or plan already saved against this call: reopening the
  // screen and pressing on should finish what is missing, not throw away work
  // you have already paid for. Rebuilding the focus is its own button.
  const startChain = () => {
    setSteps((prev) =>
      freshSteps().map((s) => {
        if (s.key === "focus" && focusRef.current.length) {
          const was = prev.find((p) => p.key === "focus");
          return was && was.status === "done" ? was : s;
        }
        if (s.key === "plan" && stage === "full") {
          const was = prev.find((p) => p.key === "plan");
          return was && was.status === "done" ? was : s;
        }
        return s;
      })
    );
    runChain(0);
  };

  // STEP 4, on your say-so. Built FROM the intent as you have left it, which
  // is the whole reason the chain stops before this.
  const buildFocus = useCallback(async () => {
    if (runningRef.current) return;
    if (!intentRef.current.trim()) return;
    runningRef.current = true;
    setChainRunning(true);
    setChainErr("");
    try {
      setStep("focus", "running", "finding what matters on this call");
      // The planner is only as good as what it reads, so assemble the context
      // now, after the research has landed and the intent is settled.
      await buildKnowledge();

      const res = await fetch("/api/interview/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: intentRef.current || null,
          role: subject?.role || null,
          companyId: companyId || null,
          focusOnly: true,
          focusAreas: [],
          subjectName: subject?.person || null,
          knowledgeContext: knowledgeRef.current,
        }),
      });
      const body = await res.text();
      let data: any = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch {
        throw new Error("the planner ran long, hit Build the focus again");
      }
      if (!res.ok) throw new Error(data.error || "could not build the focus");

      const focus: string[] = Array.isArray(data.focusAreas)
        ? data.focusAreas.filter((x: any) => typeof x === "string" && x.trim())
        : [];
      focusRef.current = focus;
      setBuiltFocus(focus);
      setStage(focus.length ? "focus" : "intent");
      setStep(
        "focus",
        focus.length ? "done" : "failed",
        focus.length
          ? `${focus.length} focus areas, yours to rank`
          : "nothing came back"
      );

      if (upcomingId && focus.length) {
        await saveSnapshot({ focus, stage: "focus" }).catch(() => {
          setStep("focus", "done", `${focus.length} focus areas, not saved`);
        });
      }
    } catch (e: any) {
      setChainErr(e?.message || "could not build the focus");
      setStep("focus", "failed", "stopped");
    } finally {
      runningRef.current = false;
      setChainRunning(false);
    }
  }, [subject, companyId, upcomingId, setStep, buildKnowledge, saveSnapshot]);

  // STEP 5, on your say-so. Built AROUND the focus list as you have left it,
  // which is the whole reason the chain stops before this.
  const buildPlan = useCallback(async () => {
    if (runningRef.current) return;
    const focus = focusRef.current;
    if (!focus.length) return;
    runningRef.current = true;
    setChainRunning(true);
    setChainErr("");
    try {
      setStep("plan", "running", "building the full plan");
      // If the page was reloaded since the focus was built, the context has to
      // be reassembled before the planner can read it.
      if (!knowledgeRef.current) await buildKnowledge();

      const res = await fetch("/api/interview/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: intentRef.current || null,
          role: subject?.role || null,
          companyId: companyId || null,
          focusOnly: false,
          focusAreas: focus,
          subjectName: subject?.person || null,
          knowledgeContext: knowledgeRef.current,
        }),
      });
      const body = await res.text();
      let data: any = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch {
        throw new Error("the planner ran long, hit Build the plan again");
      }
      if (!res.ok) throw new Error(data.error || "could not build the plan");

      const questions = (Array.isArray(data.openingQuestions)
        ? data.openingQuestions
        : []
      )
        .map((q: any) => ({
          text: typeof q === "string" ? q : q?.q || q?.text || "",
          why: typeof q === "string" ? "" : q?.why || "",
        }))
        .filter((q: any) => q.text);
      const goals = list(data.goals);
      setBuiltQuestions(questions);
      setBuiltGoals(goals);
      setStage("full");

      // The plan is only "saved to this call" if the save actually landed. A
      // throw here drops into the catch below and marks the step failed, so a
      // silent PATCH failure can never be reported as a successful save.
      let saved = false;
      if (upcomingId) {
        await saveSnapshot({
          focus,
          stage: "full",
          plan: data,
          questions,
          goals,
        });
        saved = true;
      }

      setStep(
        "plan",
        "done",
        data.degraded === true
          ? "generic, sharpen the intent and rebuild"
          : saved
          ? "saved to this call"
          : "built"
      );
    } catch (e: any) {
      setChainErr(e?.message || "could not build the plan");
      setStep("plan", "failed", "stopped");
    } finally {
      runningRef.current = false;
      setChainRunning(false);
    }
  }, [subject, companyId, upcomingId, setStep, buildKnowledge, saveSnapshot]);

  // Rank and prune the focus before the plan is built around it.
  const dropFocus = (i: number) => {
    if (chainRunning) return;
    const next = focusRef.current.filter((_, x) => x !== i);
    focusRef.current = next;
    setBuiltFocus(next);
  };

  const raiseFocus = (i: number) => {
    if (chainRunning || i === 0) return;
    const next = [...focusRef.current];
    const [moved] = next.splice(i, 1);
    next.splice(i - 1, 0, moved);
    focusRef.current = next;
    setBuiltFocus(next);
  };

  // Force a single entity to be re-researched, ignoring its cache.
  const refreshEntity = async (mode: "company" | "person") => {
    if (runningRef.current) return;
    runningRef.current = true;
    setChainRunning(true);
    setChainErr("");
    try {
      setStep(mode, "running", "re-researching");
      const base = {
        upcomingId: upcomingId || undefined,
        companyId: companyId || undefined,
        force: true,
        intent: intentRef.current || undefined,
      };
      if (mode === "company") {
        const d = await crmFetch<any>("/api/interview/research-entity", {
          method: "POST",
          body: JSON.stringify({
            ...base,
            mode: "company",
            company: subject?.companyName || name || undefined,
            website: subject?.website || undefined,
          }),
        });
        if (d.error) setStep("company", "failed", d.error);
        else {
          bgRef.current.company = d.background || "";
          setCompanyResearch({
            have: true,
            fresh: true,
            generatedAt: d.generatedAt,
            subject: d.subject || "",
            background: d.background || "",
            sources: d.sources || [],
            ttlDays: d.ttlDays ?? 0,
          });
          setStep("company", "done", "refreshed");
        }
      } else {
        const idRes = await crmFetch<any>("/api/interview/research-entity", {
          method: "POST",
          body: JSON.stringify({
            ...base,
            mode: "person",
            stage: "identify",
            contactId: subject?.contactId || undefined,
            person: subject?.person || undefined,
            personEmail: subject?.personEmail || undefined,
            role: subject?.role || undefined,
            company: subject?.companyName || name || undefined,
          }),
        });
        if (idRes.decision === "confirm") {
          setConfirmWho(idRes.identity);
          setStep("person", "waiting", "is this the right person?");
        } else if (idRes.decision === "auto") {
          // Hand straight over to the chain, which rebuilds the intent, focus
          // and plan on top of the fresh brief.
          runningRef.current = false;
          setChainRunning(false);
          await runChain(1, idRes.identity);
          return;
        } else {
          setStep("person", "skipped", idRes.error || "could not identify them");
        }
      }
    } catch (e: any) {
      setChainErr(e?.message || "could not refresh");
    } finally {
      runningRef.current = false;
      setChainRunning(false);
    }
  };

  // Open to-dos worth carrying into the intent. The tasks endpoint also injects
  // a derived "Prep: ..." meta item per upcoming call - drop those, they are
  // about prepping, not things to do for the client.
  const openTodos = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "open" && t.kind !== "prep")
        .map((t) => t.text)
        .filter(Boolean),
    [tasks]
  );

  const suggest = async () => {
    if (gen || !companyId) return;
    setGen(true);
    setGenErr("");
    setSavedToCall(false);
    try {
      const d = await crmFetch<{ intent: string; rationale: string }>(
        `/api/crm/companies/${companyId}/prep-intent`,
        { method: "POST" }
      );
      setIntent(d.intent || "");
      intentRef.current = d.intent || "";
      setRationale(d.rationale || "");
    } catch (e: any) {
      setGenErr(e?.message || "could not suggest an intent");
    } finally {
      setGen(false);
    }
  };

  const generateBattlecard = async () => {
    if (bcBusy || !companyId) return;
    setBcBusy(true);
    setBcErr("");
    try {
      const d = await crmFetch<{ battlecard: Battlecard }>(
        `/api/crm/companies/${companyId}/battlecard`,
        {
          method: "POST",
          body: JSON.stringify({
            intent: intent.trim() || undefined,
            person: subject?.person || undefined,
            role: subject?.role || undefined,
          }),
        }
      );
      if (d.battlecard) setBattlecard(d.battlecard);
    } catch (e: any) {
      setBcErr(e?.message || "could not build the battlecard");
    } finally {
      setBcBusy(false);
    }
  };

  const startCall = () => {
    const qs = new URLSearchParams();
    if (companyId) qs.set("company", companyId);
    if (name) qs.set("companyName", name);
    if (intent.trim()) qs.set("intent", intent.trim());
    if (upcomingId) qs.set("upcoming", upcomingId);
    router.push(`/call?${qs.toString()}`);
  };

  const saveToScheduled = async () => {
    if (!upcomingId || !intent.trim()) return;
    await crmFetch(`/api/crm/upcoming/${upcomingId}`, {
      method: "PATCH",
      body: JSON.stringify({ intent: intent.trim() }),
    }).catch(() => {});
    intentRef.current = intent.trim();
    setSavedToCall(true);
    window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
  };

  const copyIntent = async () => {
    try {
      await navigator.clipboard.writeText(intent.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  // Re-draft the intent from the research that has now landed, then rebuild the
  // focus and plan on top of it. Only ever on your say-so.
  const redraftIntent = async () => {
    intentRef.current = "";
    setIntent("");
    setStep("intent", "pending", "");
    await runChain(2);
  };

  const shownCalls = showAllCalls ? calls : calls.slice(0, 5);

  const chainLabel = chainRunning
    ? "prepping…"
    : chainDone
    ? "↻ prep again"
    : "prep this call ▸";

  if (!companyId && !upcomingId) {
    return (
      <main className="relative z-10 mx-auto max-w-[820px] px-5 py-10">
        <p className="font-mono text-[0.7rem] text-muted">
          No client selected. Open prep from a client or an upcoming call.
        </p>
        <Link
          href="/crm"
          className="mt-3 inline-block rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ clients
        </Link>
        <NavMenu />
      </main>
    );
  }

  return (
    <main className="relative z-10 mx-auto max-w-[860px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <div className="flex items-baseline gap-3">
          <Link
            href={companyId ? `/crm/${companyId}` : "/crm"}
            className="font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            ◂ {name || "client"}
          </Link>
          <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
            <span className="italic text-amber">Prep</span>{" "}
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
              next call
            </span>
          </h1>
        </div>
        <Link
          href={
            upcomingId
              ? `/call?company=${companyId}&companyName=${encodeURIComponent(
                  name
                )}&upcoming=${upcomingId}`
              : `/call?company=${companyId}&companyName=${encodeURIComponent(
                  name
                )}`
          }
          className="rounded-full border border-sage/60 bg-sage/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
        >
          open call screen ▸
        </Link>
      </header>

      {/* THE PREP CHAIN researches the company/person and drafts the intent,
          then deliberately stops so the user can review it before building
          either the focus or the plan. Existing research is reused. */}
      <section className="mb-6 rounded-2xl border border-sky/40 bg-sky/[0.05] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-sky">
            ⚙ Prep chain
          </p>
          <button
            type="button"
            onClick={startChain}
            disabled={chainRunning}
            className="rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
          >
            {chainLabel}
          </button>
        </div>

        <p className="mb-3 font-sans text-[0.82rem] leading-relaxed text-bone/75">
          {subject?.person || subject?.companyName ? (
            <>
              This call is with{" "}
              <span className="text-bone">
                {subject?.person || "someone unnamed"}
              </span>
              {subject?.companyName ? (
                <>
                  {" "}
                  at <span className="text-bone">{subject.companyName}</span>
                </>
              ) : null}
              . One press researches them both and drafts the intent, then stops.
              Review or change the intent before you choose to build the focus.
              Research is bought once per company and once per person and reused
              for every call with them after that.
            </>
          ) : (
            "One press researches the company and the person and drafts the intent, then stops. Review or change the intent before you choose to build the focus. Research is bought once per company and once per person and reused for every call with them after that."
          )}
        </p>

        <ul className="flex flex-col gap-1.5">
          {steps.map((st) => {
            const refreshable =
              (st.key === "company" || st.key === "person") &&
              (st.status === "done" || st.status === "skipped");
            return (
              <li key={st.key} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-3 shrink-0 text-center">
                  <StepDot status={st.status} />
                </span>
                <span
                  className={`font-sans text-[0.84rem] leading-snug ${
                    st.status === "pending" ? "text-bone/45" : "text-bone/85"
                  }`}
                >
                  {st.label}
                  {st.note && (
                    <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                      {st.note}
                    </span>
                  )}
                  {st.key === "intent" &&
                    st.status === "done" &&
                    st.note.includes("yours is kept") && (
                      <button
                        type="button"
                        onClick={redraftIntent}
                        disabled={chainRunning}
                        className="ml-2 font-mono text-[0.6rem] uppercase tracking-wider text-amber underline-offset-2 transition hover:underline disabled:opacity-40"
                      >
                        re-draft from research
                      </button>
                    )}
                  {refreshable && (
                    <button
                      type="button"
                      onClick={() =>
                        refreshEntity(st.key as "company" | "person")
                      }
                      disabled={chainRunning}
                      className="ml-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted underline-offset-2 transition hover:text-amber hover:underline disabled:opacity-40"
                    >
                      refresh
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {chainErr && (
          <p className="mt-3 font-mono text-[0.66rem] text-rust">{chainErr}</p>
        )}

        {/* The identity gate. A medium or low confidence match stops here rather
            than briefing a stranger and letting it poison everything downstream. */}
        {confirmWho && (
          <div className="mt-3 rounded-xl border border-sky/50 bg-ink/50 p-3">
            <p className="font-mono text-[0.56rem] uppercase tracking-[0.18em] text-sky">
              Confirm who this is
            </p>
            <p className="mt-1 font-sans text-[0.86rem] leading-snug text-bone">
              {confirmWho.name}
              {confirmWho.headline ? `, ${confirmWho.headline}` : ""}
              {confirmWho.org ? `, ${confirmWho.org}` : ""}
              {confirmWho.location ? `, ${confirmWho.location}` : ""}
            </p>
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-wider text-muted">
              {confirmWho.confidence || "unknown"} confidence, so I stopped
              before spending on the brief
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runChain(1, confirmWho)}
                className="rounded-full border border-sage/60 bg-sage/15 px-3.5 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
              >
                that&apos;s them, carry on ▸
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmWho(null);
                  setStep("person", "skipped", "skipped, wrong person");
                  runChain(2);
                }}
                className="rounded-full border border-edge px-3.5 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
              >
                not them, skip the brief
              </button>
            </div>
          </div>
        )}

        {/* What the chain produced, so you can see it worked without opening the
            call screen. */}
        {(builtFocus.length > 0 || builtQuestions.length > 0) && (
          <div className="mt-4 flex flex-col gap-3 border-t border-edge pt-3">
            {builtFocus.length > 0 && (
              <div>
                <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-amber">
                  Focus
                  {stage !== "full" && (
                    <span className="ml-2 normal-case tracking-normal text-muted">
                      rank it and drop what does not belong, the plan is built
                      around this
                    </span>
                  )}
                </p>
                <ol className="flex flex-col gap-1">
                  {builtFocus.map((f, i) => (
                    <li
                      key={`${f}-${i}`}
                      className="flex items-start gap-2 font-sans text-[0.82rem] leading-snug text-bone/85"
                    >
                      <span className="mt-[1px] w-3 shrink-0 text-right font-mono text-[0.64rem] text-amber/80">
                        {i + 1}
                      </span>
                      <span className="flex-1">{f}</span>
                      {stage !== "full" && (
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => raiseFocus(i)}
                            disabled={chainRunning || i === 0}
                            title="move up"
                            aria-label="move up"
                            className="rounded border border-edge px-1.5 font-mono text-[0.58rem] text-muted transition hover:border-amber/50 hover:text-amber disabled:opacity-25"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => dropFocus(i)}
                            disabled={chainRunning}
                            title="remove"
                            aria-label="remove"
                            className="rounded border border-edge px-1.5 font-mono text-[0.58rem] text-muted transition hover:border-rust/50 hover:text-rust disabled:opacity-25"
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
                {stage !== "full" && (
                  <button
                    type="button"
                    onClick={buildPlan}
                    disabled={chainRunning || !builtFocus.length}
                    className="mt-2.5 rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
                  >
                    {chainRunning ? "building…" : "build the plan ▸"}
                  </button>
                )}
              </div>
            )}
            {builtQuestions.length > 0 && (
              <div>
                <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sage">
                  Opening questions
                </p>
                <ul className="flex flex-col gap-1.5">
                  {builtQuestions.map((q, i) => (
                    <li key={i}>
                      <p className="font-sans text-[0.82rem] leading-snug text-bone/85">
                        {q.text}
                      </p>
                      {q.why && (
                        <p className="font-sans text-[0.74rem] leading-snug text-bone/50">
                          {q.why}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {builtGoals.length > 0 && (
              <div>
                <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sky">
                  Goals
                </p>
                <ul className="flex flex-col gap-1">
                  {builtGoals.map((g, i) => (
                    <li
                      key={i}
                      className="flex gap-2 font-sans text-[0.82rem] leading-snug text-bone/85"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky/70" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {chainDone && stage === "full" && (
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-sage">
                {upcomingId
                  ? "saved to this call, open the call screen and it lands ready"
                  : "built, start the call with this intent"}
              </p>
            )}
          </div>
        )}

        {/* The raw briefs, folded away. They are long, and the plan has already
            read them, but you may want to read them yourself before the call. */}
        {(companyResearch?.background || personResearch?.background) && (
          <div className="mt-3 border-t border-edge pt-3">
            <button
              type="button"
              onClick={() => setOpenBriefs((v) => !v)}
              className="font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:text-amber"
            >
              {openBriefs ? "hide the briefs" : "read the briefs"}
            </button>
            {openBriefs && (
              <div className="mt-2 flex flex-col gap-3">
                {personResearch?.background && (
                  <div>
                    <p className="mb-1 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sky">
                      {personResearch.subject || subject?.person || "Person"}
                      <span className="ml-2 text-muted">
                        {ageLabel(personResearch.generatedAt)}
                      </span>
                    </p>
                    <p className="whitespace-pre-wrap font-sans text-[0.8rem] leading-relaxed text-bone/80">
                      {personResearch.background}
                    </p>
                  </div>
                )}
                {companyResearch?.background && (
                  <div>
                    <p className="mb-1 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-amber">
                      {companyResearch.subject || name || "Company"}
                      <span className="ml-2 text-muted">
                        {ageLabel(companyResearch.generatedAt)}
                      </span>
                    </p>
                    <p className="whitespace-pre-wrap font-sans text-[0.8rem] leading-relaxed text-bone/80">
                      {companyResearch.background}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* SUGGESTED INTENT - the review card. The chain fills this in, and you can
          still edit it or pull a fresh one by hand. */}
      <section className="mb-6 rounded-2xl border border-amber/40 bg-amber/[0.05] p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
            ✶ Intent
          </p>
          {companyId && (
            <button
              type="button"
              onClick={suggest}
              disabled={gen}
              className="rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
            >
              {gen
                ? "thinking…"
                : intent
                ? "↻ regenerate"
                : "suggest from history"}
            </button>
          )}
        </div>

        {!intent && !gen && (
          <p className="font-sans text-[0.84rem] leading-relaxed text-bone/75">
            The prep chain drafts this from the research and the history. You can
            also pull one by hand, or just write your own line. Nothing drives a
            call until you start it.
          </p>
        )}

        {genErr && (
          <p className="mt-1 font-mono text-[0.66rem] text-rust">{genErr}</p>
        )}

        {(intent || gen) && (
          <>
            <textarea
              value={intent}
              onChange={(e) => {
                setIntent(e.target.value);
                intentRef.current = e.target.value;
                setSavedToCall(false);
              }}
              rows={5}
              placeholder={gen ? "building your intent…" : ""}
              className="mt-1 w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
            />
            {rationale && (
              <p className="mt-2 font-sans text-[0.78rem] leading-snug text-bone/60">
                <span className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                  why this:{" "}
                </span>
                {rationale}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* The focus is built FROM this intent, so it lives here, next to
                  the words it reads. Nothing downstream runs until you press
                  it, which is what stops a wrong intent producing a focus you
                  then have to pay for twice. */}
              <button
                type="button"
                onClick={buildFocus}
                disabled={chainRunning || !intent.trim()}
                className="rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
              >
                {chainRunning && stage === "intent"
                  ? "building…"
                  : builtFocus.length
                  ? "rebuild the focus"
                  : "build the focus ▸"}
              </button>
              <button
                type="button"
                onClick={startCall}
                disabled={!intent.trim()}
                className="rounded-full border border-sage/60 bg-sage/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:opacity-40"
              >
                start call with this ▸
              </button>
              {upcomingId && (
                <button
                  type="button"
                  onClick={saveToScheduled}
                  disabled={!intent.trim()}
                  className="rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
                >
                  {savedToCall ? "saved to call ✓" : "save to scheduled call"}
                </button>
              )}
              <button
                type="button"
                onClick={copyIntent}
                disabled={!intent.trim()}
                className="rounded-full border border-edge px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber disabled:opacity-40"
              >
                {copied ? "copied ✓" : "copy"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* BATTLE PLAN - the grounded, call-specific playbook: objections with
          the right response, flow, what not to say, questions, next step. */}
      {companyId && (
        <section className="mb-6 rounded-2xl border border-rust/40 bg-rust/[0.05] p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-rust">
              ⚑ Battle plan
            </p>
            <button
              type="button"
              onClick={generateBattlecard}
              disabled={bcBusy}
              className="rounded-full border border-rust/60 bg-rust/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust/25 disabled:opacity-40"
            >
              {bcBusy
                ? "researching…"
                : battlecard
                ? "↻ rebuild"
                : "build battle plan"}
            </button>
          </div>

          {!battlecard && !bcBusy && (
            <p className="font-sans text-[0.84rem] leading-relaxed text-bone/75">
              Build a call-specific playbook for {name || "this client"}: the
              objections they will raise with the honest response, where the
              product fits and where it does not, a timed flow, the spoken pitch,
              what not to say, sharp questions, and the next step. It researches
              the client on the web and grounds the product answers in your brain
              and objection stances. Takes a few seconds and a few pence.
            </p>
          )}
          {bcBusy && !battlecard && (
            <p className="font-mono text-[0.7rem] text-muted">
              Researching the client and assembling the plan…
            </p>
          )}
          {bcErr && (
            <p className="mt-1 font-mono text-[0.66rem] text-rust">{bcErr}</p>
          )}

          {battlecard && (
            <div className="mt-1 flex flex-col gap-4">
              {battlecard.oneLiner && (
                <p className="font-sans text-[0.9rem] leading-snug text-bone">
                  {battlecard.oneLiner}
                </p>
              )}

              {(battlecard.fit?.strong?.length > 0 ||
                battlecard.fit?.weak?.length > 0) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {battlecard.fit?.strong?.length > 0 && (
                    <div className="rounded-xl border border-edge bg-ink/40 p-3">
                      <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sage">
                        Strong fit
                      </p>
                      <ul className="flex flex-col gap-1">
                        {battlecard.fit.strong.map((t, i) => (
                          <li
                            key={i}
                            className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                          >
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sage/70" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {battlecard.fit?.weak?.length > 0 && (
                    <div className="rounded-xl border border-edge bg-ink/40 p-3">
                      <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-rust">
                        Weak fit, do not oversell
                      </p>
                      <ul className="flex flex-col gap-1">
                        {battlecard.fit.weak.map((t, i) => (
                          <li
                            key={i}
                            className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                          >
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rust/70" />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {battlecard.pitch && (
                <div className="rounded-xl border border-edge bg-ink/40 p-3">
                  <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-amber">
                    The spoken pitch
                  </p>
                  <p className="font-sans text-[0.84rem] leading-relaxed text-bone/85">
                    {battlecard.pitch}
                  </p>
                </div>
              )}

              {battlecard.flow?.length > 0 && (
                <div>
                  <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sky">
                    Suggested flow
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {battlecard.flow.map((f, i) => (
                      <li key={i} className="flex gap-2.5">
                        {f.minutes && (
                          <span className="mt-0.5 shrink-0 font-mono text-[0.6rem] uppercase tracking-wider text-sky/80">
                            {f.minutes} min
                          </span>
                        )}
                        <span className="font-sans text-[0.82rem] leading-snug text-bone/85">
                          {f.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {battlecard.objections?.length > 0 && (
                <div>
                  <p className="mb-2 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-rust">
                    Objections and the right response
                  </p>
                  <ul className="flex flex-col gap-2.5">
                    {battlecard.objections.map((o, i) => (
                      <li
                        key={i}
                        className="rounded-xl border border-edge bg-ink/40 p-3"
                      >
                        <p className="font-sans text-[0.84rem] font-medium leading-snug text-bone">
                          {o.objection}
                        </p>
                        {o.response && (
                          <p className="mt-1 font-sans text-[0.82rem] leading-relaxed text-bone/80">
                            <span className="font-mono text-[0.52rem] uppercase tracking-wider text-sage">
                              say{" "}
                            </span>
                            {o.response}
                          </p>
                        )}
                        {o.haveReady && (
                          <p className="mt-1.5 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 font-sans text-[0.78rem] leading-snug text-amber">
                            <span className="font-mono text-[0.52rem] uppercase tracking-wider">
                              have ready{" "}
                            </span>
                            {o.haveReady}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {battlecard.doNotSay?.length > 0 && (
                  <div className="rounded-xl border border-edge bg-ink/40 p-3">
                    <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-rust">
                      Do not say
                    </p>
                    <ul className="flex flex-col gap-1">
                      {battlecard.doNotSay.map((t, i) => (
                        <li
                          key={i}
                          className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rust/70" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {battlecard.questionsToAsk?.length > 0 && (
                  <div className="rounded-xl border border-edge bg-ink/40 p-3">
                    <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sky">
                      Questions to ask
                    </p>
                    <ul className="flex flex-col gap-1">
                      {battlecard.questionsToAsk.map((t, i) => (
                        <li
                          key={i}
                          className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky/70" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {battlecard.nextStep && (
                <div className="rounded-xl border border-sage/40 bg-sage/[0.06] p-3">
                  <p className="mb-1 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sage">
                    Next step to push for
                  </p>
                  <p className="font-sans text-[0.84rem] leading-snug text-bone/85">
                    {battlecard.nextStep}
                  </p>
                </div>
              )}

              {battlecard.sources?.length > 0 && (
                <div>
                  <p className="mb-1 font-mono text-[0.52rem] uppercase tracking-[0.18em] text-muted">
                    Researched from
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {battlecard.sources.map((s, i) => (
                      <li key={i} className="truncate">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[0.62rem] text-sky/80 transition hover:text-amber"
                        >
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* OPEN TO-DOS - the things you said you'd do for this client. */}
      {openTodos.length > 0 && (
        <section className="mb-6 rounded-xl border border-edge bg-panel/40 p-4">
          <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sage">
            ✓ Open to-dos
          </p>
          <ul className="flex flex-col gap-1.5">
            {openTodos.map((t, i) => (
              <li
                key={i}
                className="flex gap-2 font-sans text-[0.84rem] leading-snug text-bone/85"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sage/70" />
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* PLAYBOOK - the strategic plays to move this client forward. */}
      {playbook.length > 0 && (
        <section className="mb-6 rounded-xl border border-edge bg-panel/40 p-4">
          <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
            ♟ Playbook
          </p>
          <ol className="flex flex-col gap-1.5">
            {playbook.map((p, i) => (
              <li
                key={i}
                className="flex gap-2.5 font-sans text-[0.84rem] leading-snug text-bone/85"
              >
                <span className="font-mono text-[0.66rem] text-amber/80">
                  {i + 1}
                </span>
                {p}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* PREVIOUS CALL SUMMARIES - so you can sanity-check the intent against
          what actually happened, and catch anything the suggestion missed. */}
      <section>
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
          ▦ Previous calls
        </p>

        {!calls.length ? (
          <p className="font-mono text-[0.66rem] leading-relaxed text-muted">
            {loaded
              ? "No call summaries on file for this client yet. Run a call and it will show up here for next time."
              : "Loading…"}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {shownCalls.map((c) => {
                const s = c.summary || {};
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-edge bg-panel/40 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                        {fmtDate(c.created_at)}
                        {c.candidate ? ` · ${c.candidate}` : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        {s.recommendation && (
                          <span className="rounded-full border border-amber/40 bg-amber/10 px-2.5 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider text-amber">
                            {s.recommendation}
                          </span>
                        )}
                        <Link
                          href={`/crm/calls/${c.id}`}
                          className="font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:text-amber"
                        >
                          full scorecard ↗
                        </Link>
                      </div>
                    </div>

                    {s.headline && (
                      <p className="mt-2 font-sans text-[0.9rem] leading-snug text-bone">
                        {s.headline}
                      </p>
                    )}
                    {s.overview && (
                      <p className="mt-1 font-sans text-[0.82rem] leading-relaxed text-bone/70">
                        {s.overview}
                      </p>
                    )}

                    <Actions
                      title="→ You still owe"
                      items={list(s.myNextActions)}
                      tone="text-amber"
                    />
                    <Actions
                      title="They said they'd"
                      items={list(s.theirNextActions)}
                      tone="text-sky"
                    />
                    <Actions
                      title="Suggested next moves"
                      items={list(s.suggestedNextActions)}
                      tone="text-sage"
                    />
                    <Actions
                      title="Not covered"
                      items={list(s.notCovered)}
                      tone="text-muted"
                    />
                  </li>
                );
              })}
            </ul>
            {calls.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllCalls((v) => !v)}
                className="mt-3 w-full rounded-lg border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
              >
                {showAllCalls ? "show less" : `show all ${calls.length} calls`}
              </button>
            )}
          </>
        )}
      </section>

      <NavMenu />
    </main>
  );
}

export default function PrepPage() {
  return (
    <Suspense
      fallback={
        <main className="relative z-10 mx-auto max-w-[860px] px-5 py-10">
          <p className="font-mono text-[0.66rem] text-muted">Loading…</p>
        </main>
      }
    >
      <PrepInner />
    </Suspense>
  );
}
