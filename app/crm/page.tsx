"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { crmConfirmationError, crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import UpcomingCalls from "@/components/crm/UpcomingCalls";
import TaskList from "@/components/crm/TaskList";
import Commitments from "@/components/crm/Commitments";
import CrmSearch from "@/components/crm/CrmSearch";
import { capitaliseSentenceStarts } from "@/lib/text";
import MatrixRain from "@/components/MatrixRain";

// These sections sit below the first decision layer or only appear when they
// contain data. Loading them separately keeps the Today dashboard interactive
// while drag-and-drop, duplicate review and call-history code arrive.
const MorningCheckin = dynamic(
  () => import("@/components/crm/MorningCheckin"),
  { ssr: false }
);
const OpportunityBoard = dynamic(
  () => import("@/components/crm/OpportunityBoard"),
  {
    ssr: false,
    loading: () => (
      <MatrixRain size="inline" className="mb-3" messages={["loading opportunity priorities"]} />
    ),
  }
);
const DuplicateClients = dynamic(
  () => import("@/components/crm/DuplicateClients"),
  { ssr: false }
);
const RecentCalls = dynamic(() => import("@/components/crm/RecentCalls"), {
  ssr: false,
});

type Dash = {
  kpis: {
    clients: number;
    tasks: number;
    drafts: number;
    openOppValue: number;
    openOppCount: number;
    weekCost: number;
    monthCost: number;
    allCost: number;
    costBreakdown?: {
      calls: { week: number; month: number; all: number };
      ai: { week: number; month: number; all: number };
      automation: { week: number; month: number; all: number };
    };
    featureCosts?: {
      feature: string;
      week: number;
      month: number;
      all: number;
    }[];
    costPeriods?: {
      week: { start: string; end: string };
      month: { start: string; end: string };
    };
  };
  tasks: {
    text: string;
    company: string;
    companyId: string;
    kind: string;
    note?: string;
  }[];
  dayRead: string;
  // "Your day" broken into one line per client / priority. Items with a fixed
  // time (scheduled calls) carry `time` and lead the list. `companyId`, when
  // present, makes the line clickable through to that client.
  dayParts?: {
    label: string;
    text: string;
    time?: string;
    companyId?: string;
  }[];
  today?: {
    callsToPrep: TodayItem[];
    overduePromises: TodayItem[];
    awaitingReply: TodayItem[];
    awaitingOthers: TodayItem[];
    coolingDeals: TodayItem[];
    topActions: (TodayItem & { reason: string })[];
  };
  weeklyReview?: {
    key: string;
    label: string;
    count: number;
    href: string;
  }[];
};

type TodayItem = {
  id: string;
  text: string;
  company?: string | null;
  at?: string | number | null;
  href: string;
  entity?: "task" | "activity" | "upcoming";
  companyId?: string;
  contextId?: string;
};

type AiMode = "economical" | "balanced" | "high";

const todayTaskGroups = [
  "callsToPrep",
  "overduePromises",
  "awaitingReply",
  "awaitingOthers",
  "coolingDeals",
  "topActions",
] as const;

const changeTodayTask = (
  current: Dash | null,
  id: string,
  change: (item: TodayItem) => TodayItem | null
) => {
  if (!current?.today) return current;
  const today = { ...current.today };
  for (const key of todayTaskGroups) {
    today[key] = (today[key] || [])
      .map((item) => (item.id === id ? change(item) : item))
      .filter(Boolean) as any;
  }
  return { ...current, today };
};

export default function DashboardPage() {
  // Seed from the last response (cached in-memory) so a revisit renders
  // instantly with no blink; the fetches below refresh it in the background.
  const [dash, setDash] = useState<Dash | null>(
    () =>
      getCached<Dash>("/api/crm/dashboard") ||
      getCached<Dash>("/api/crm/dashboard?light=1") ||
      null
  );
  const [costMode, setCostMode] = useState<"week" | "month">("week");
  const [aiMode, setAiMode] = useState<AiMode>("balanced");
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem("lc_dashboard_view") !== "full";
    } catch {
      return true;
    }
  });
  const [modeSaving, setModeSaving] = useState(false);
  const [todaySavingId, setTodaySavingId] = useState<string | null>(null);
  const [todaySaveError, setTodaySaveError] = useState("");
  const dashboardSeq = useRef(0);
  const closedTodayIds = useRef(new Set<string>());

  useEffect(() => {
    try {
      localStorage.setItem("lc_dashboard_view", focusMode ? "focus" : "full");
    } catch {
      /* preference is optional */
    }
  }, [focusMode]);

  const refreshDashboard = useCallback(async () => {
    const seq = ++dashboardSeq.current;
    let next: Dash | null = await crmFetch<Dash>("/api/crm/dashboard?light=1");
    if (seq !== dashboardSeq.current) return;
    for (const id of closedTodayIds.current)
      next = changeTodayTask(next, id, () => null);
    // The light response now contains deterministic, current day points. Do
    // not preserve the old AI snapshot after a tick/delete/edit, because that
    // is exactly what made a successfully saved task appear to come back.
    setDash(next);
  }, []);

  const resolveTodayActivity = async (
    item: TodayItem,
    action: "apply" | "dismiss"
  ) => {
    if (!item.companyId || !item.contextId) {
      setTodaySaveError("That client update is missing its saved source. Open the client to review it.");
      return;
    }
    const previous = dash;
    dashboardSeq.current += 1;
    closedTodayIds.current.add(item.id);
    setDash((current) => changeTodayTask(current, item.id, () => null));
    setTodaySaveError("");
    setTodaySavingId(item.id);
    try {
      const result = await crmFetch<{
        intelligence: { status: "pending" | "applied" | "dismissed" };
      }>(`/api/crm/companies/${item.companyId}/activity/approve`, {
        method: "POST",
        body: JSON.stringify({
          contextId: item.contextId,
          action,
        }),
      });
      const expected = action === "dismiss" ? "dismissed" : "applied";
      if (result.intelligence?.status !== expected)
        throw crmConfirmationError({
          url: `/api/crm/companies/${item.companyId}/activity/approve`,
          method: "POST",
          reason: "LiveCoach returned a different client update decision from the one selected",
        });
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch {
      closedTodayIds.current.delete(item.id);
      setDash(previous);
      setTodaySaveError("That client update did not save. Please try again.");
    } finally {
      setTodaySavingId(null);
    }
  };

  const dismissTodayUpcoming = async (item: TodayItem) => {
    const previous = dash;
    dashboardSeq.current += 1;
    closedTodayIds.current.add(item.id);
    setDash((current) => changeTodayTask(current, item.id, () => null));
    setTodaySaveError("");
    setTodaySavingId(item.id);
    try {
      const result = await crmFetch<{ ok: boolean }>(
        `/api/crm/upcoming/${item.id}`,
        { method: "DELETE" }
      );
      if (!result.ok)
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${item.id}`,
          method: "DELETE",
          reason: "LiveCoach did not confirm that the calendar item was hidden",
        });
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch {
      closedTodayIds.current.delete(item.id);
      setDash(previous);
      setTodaySaveError("That calendar item was not hidden. Please try again.");
    } finally {
      setTodaySavingId(null);
    }
  };

  useEffect(() => {
    let alive = true;
    // Paint immediately from the light (no-AI) response, then fold in the
    // "Your day" blurb when the slower AI call returns - so the dashboard
    // never blocks on an LLM call.
    refreshDashboard()
      .then(() => {
        if (!alive) return;
        // The AI day read is optional. Start it only after the factual dashboard
        // is already painted so its repeated context queries and model call can
        // never delay the controls the user needs first.
        return crmFetch<Dash>("/api/crm/dashboard").then(
          (d) =>
            alive &&
            setDash((prev) =>
              prev
                ? { ...prev, dayRead: d.dayRead, dayParts: d.dayParts }
                : d
            )
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshDashboard]);

  useEffect(() => {
    // Maintenance is important, but it used to compete with the first visible
    // dashboard request. Give the useful Today view a head start, then run the
    // same self-healing work together in the background.
    const timer = window.setTimeout(() => {
      Promise.allSettled([
        fetch("/api/interview/backfill-scorecards"),
        fetch("/api/crm/tasks/sweep-stale"),
        fetch("/api/crm/tasks/fold-loose"),
      ]).then(() =>
        window.dispatchEvent(new CustomEvent("lc:tasks-updated"))
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  // A task can be changed from Do next, an opportunity, commitments, or the
  // Today cards. Keep the entire dashboard snapshot in lockstep with all of
  // them instead of leaving stale points visible until a page reload.
  useEffect(() => {
    const onTasksUpdated = () => refreshDashboard().catch(() => {});
    window.addEventListener("lc:tasks-updated", onTasksUpdated);
    return () => window.removeEventListener("lc:tasks-updated", onTasksUpdated);
  }, [refreshDashboard]);

  useEffect(() => {
    crmFetch<{ mode: AiMode }>("/api/crm/ai-mode")
      .then((d) => setAiMode(d.mode || "balanced"))
      .catch(() => {});
  }, []);

  const chooseAiMode = async (mode: AiMode) => {
    setAiMode(mode);
    setModeSaving(true);
    try {
      const saved = await crmFetch<{ mode: AiMode }>("/api/crm/ai-mode", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });
      if (saved.mode !== mode)
        throw crmConfirmationError({
          url: "/api/crm/ai-mode",
          method: "PUT",
          reason: "LiveCoach returned a different AI mode from the one selected",
        });
      setAiMode(saved.mode);
    } catch {
      setAiMode(aiMode);
    } finally {
      setModeSaving(false);
    }
  };

  // Live-update on every return to the tab: refetch the dashboard and tell the
  // list cards (upcoming, recent, to-dos, commitments) to refresh, so a call
  // that finished while you were away - or that the safety-net sweep just
  // summarised - shows up without a manual reload.
  useEffect(() => {
    const onRefresh = () => {
      if (document.visibilityState === "hidden") return;
      crmFetch<Dash>("/api/crm/dashboard")
        .then((d) => {
          let next: Dash | null = d;
          for (const id of closedTodayIds.current)
            next = changeTodayTask(next, id, () => null);
          setDash(next);
        })
        .catch(() => {});
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    };
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, []);

  const gbp = (n: number) =>
    `£${Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const costNow =
    costMode === "week" ? dash?.kpis.weekCost : dash?.kpis.monthCost;
  const costPeriod = dash?.kpis.costPeriods?.[costMode];
  const dateLabel = (value?: string) => {
    if (!value) return "";
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  };

  // Weekly spend guide. A soft budget: when this week's all-in spend goes over
  // it, the dashboard flags it and names the biggest driver. Change
  // WEEK_GUIDE_GBP to your own comfort level.
  const WEEK_GUIDE_GBP = 20;
  const weekSpend = dash?.kpis.weekCost ?? 0;
  const overGuide = weekSpend > WEEK_GUIDE_GBP;
  const cb = dash?.kpis.costBreakdown;
  const driver = cb
    ? (
        [
          ["calls", cb.calls.week],
          ["in-app AI", cb.ai.week],
          ["automation", cb.automation.week],
        ] as [string, number][]
      ).sort((a, b) => b[1] - a[1])[0]
    : null;
  const monthlyPace = weekSpend * (30 / 7);

  const statCls =
    "rounded-lg border border-edge bg-ink/40 px-3 py-2.5 text-left transition hover:border-amber/50";

  const shortDate = (value?: string | number | null) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const todayGroups = dash?.today
    ? [
        ["Calls to prepare", dash.today.callsToPrep, "text-amber"],
        ["Overdue promises", dash.today.overduePromises, "text-rust"],
        ["Replies ready", dash.today.awaitingReply, "text-sky"],
        ["Waiting on others", dash.today.awaitingOthers || [], "text-rust"],
        ["Cooling deals", dash.today.coolingDeals, "text-muted"],
      ] as const
    : [];
  const otherTodayActions = (dash?.today?.topActions || []).filter(
    (item) => item.entity !== "task"
  );

  const modeCopy: Record<AiMode, string> = {
    economical: "Slow automatic cues, Terra ideas off",
    balanced: "Normal cues, occasional Terra ideas",
    high: "Fast cues, frequent Terra ideas",
  };

  return (
    <main className="relative z-10 mx-auto max-w-[1000px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.55rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / dashboard
          </span>
        </h1>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <div className="flex overflow-hidden rounded-full border border-amber/45">
            <button
              type="button"
              onClick={() => setFocusMode(true)}
              aria-pressed={focusMode}
              className={`px-3 py-1.5 font-mono text-[0.52rem] uppercase tracking-wider ${
                focusMode ? "bg-amber/15 text-amber" : "text-muted hover:text-bone"
              }`}
            >
              Focus
            </button>
            <button
              type="button"
              onClick={() => setFocusMode(false)}
              aria-pressed={!focusMode}
              className={`px-3 py-1.5 font-mono text-[0.52rem] uppercase tracking-wider ${
                !focusMode ? "bg-amber/15 text-amber" : "text-muted hover:text-bone"
              }`}
            >
              Full
            </button>
          </div>
          {/* Spend so far - compact, with a weekly / monthly toggle. */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
              spend
            </span>
            <span className="font-mono text-[0.8rem] tabular-nums text-sage">
              {dash ? gbp(costNow || 0) : "—"}
            </span>
            <div className="flex overflow-hidden rounded-full border border-edge">
              {(["week", "month"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCostMode(m)}
                  title={m === "week" ? "last 7 days" : "last 30 days"}
                  className={`px-2 py-1 font-mono text-[0.5rem] uppercase tracking-wider transition ${
                    costMode === m
                      ? "bg-amber/15 text-amber"
                      : "text-muted hover:text-bone"
                  }`}
                >
                  {m === "week" ? "wk" : "mo"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <CrmSearch />

      <Link
        href="/crm/revenue"
        className="mb-3 flex min-h-12 items-center justify-between rounded-xl border border-moss/45 bg-moss/[0.07] px-4 py-3 transition hover:border-moss hover:bg-moss/[0.12]"
      >
        <span>
          <span className="block font-mono text-[0.58rem] uppercase tracking-[0.2em] text-moss">◆ Revenue command centre</span>
          <span className="mt-1 block text-sm text-bone/75">Weighted forecast, target coverage, pipeline stages and the highest-priority moves.</span>
        </span>
        <span className="ml-3 text-moss">↗</span>
      </Link>

      {/* TODAY: the first decision layer, built from factual CRM state without
          another model call. The highest-ranked moves are deliberately first. */}
      <section className="mb-3 rounded-2xl border border-amber/45 bg-gradient-to-br from-amber/[0.09] to-transparent p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-amber">
              {"◆"} Today
            </p>
            <p className="mt-1 font-sans text-[0.8rem] text-bone/65">
              Your most important moves, ranked across deadlines, promises and revenue.
            </p>
          </div>
          <span className="rounded-full border border-edge px-2.5 py-1 font-mono text-[0.52rem] uppercase tracking-wider text-muted">
            live CRM state
          </span>
        </div>
        {todaySaveError && (
          <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 font-sans text-[0.78rem] text-rust">
            {todaySaveError}
          </p>
        )}
        {otherTodayActions.length ? (
          <ol className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {otherTodayActions.map((item, i) => (
              <li key={`${item.reason}-${item.id}`}>
                <div className="group flex h-full flex-col rounded-xl border border-edge bg-ink/55 p-3 transition hover:border-amber/60">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[0.55rem] uppercase tracking-wider text-amber">
                      {i + 1}. {item.reason}
                    </span>
                    <span className="text-muted transition group-hover:text-amber">↗</span>
                  </div>
                  <Link href={item.href} className="font-sans text-[0.86rem] leading-snug text-bone hover:text-amber">
                    {capitaliseSentenceStarts(item.text)}
                  </Link>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                      {item.company || "General"}
                      {item.at ? ` · ${shortDate(item.at)}` : ""}
                    </p>
                    {item.entity === "activity" ? (
                      <span className="flex items-center gap-1">
                        <Link href={item.href} className="rounded px-2 py-1 font-mono text-[0.52rem] uppercase text-muted hover:text-amber">review</Link>
                        <button type="button" disabled={todaySavingId === item.id} onClick={() => void resolveTodayActivity(item, "apply")} aria-label="Apply client update" title="Apply the saved CRM changes" className="rounded px-2 py-1 font-mono text-[0.68rem] text-muted hover:text-sage disabled:opacity-40">✓</button>
                        <button type="button" disabled={todaySavingId === item.id} onClick={() => void resolveTodayActivity(item, "dismiss")} aria-label="Dismiss client update" title="Remove this review without applying changes" className="rounded px-2 py-1 font-mono text-[0.68rem] text-muted hover:text-rust disabled:opacity-40">✕</button>
                      </span>
                    ) : item.entity === "upcoming" ? (
                      <button
                        type="button"
                        disabled={todaySavingId === item.id}
                        onClick={() => void dismissTodayUpcoming(item)}
                        aria-label={`Hide ${item.text} from LiveCoach`}
                        title="Hide this from LiveCoach. It stays in your calendar."
                        className="rounded px-2 py-1 font-mono text-[0.68rem] text-muted hover:text-rust disabled:opacity-40"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        {!focusMode ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {todayGroups.map(([label, items, colour]) => (
              <div key={label} className="rounded-lg border border-edge/80 bg-panel/35 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className={`font-mono text-[0.53rem] uppercase tracking-wider ${colour}`}>
                    {label}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-bone">{items.length}</span>
                </div>
                {items[0] ? (
                  <Link href={items[0].href} className="block font-sans text-[0.76rem] leading-snug text-bone/70 hover:text-bone">
                    {items[0].company ? `${items[0].company}: ` : ""}{capitaliseSentenceStarts(items[0].text)}
                  </Link>
                ) : (
                  <span className="font-mono text-[0.56rem] text-muted">clear</span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {!focusMode ? <>
      {/* COST CONTROL: true recorded spend, split by feature, plus a persisted
          live-intelligence cadence. Terra quality remains available in all modes. */}
      <section id="costs" className="mb-3 scroll-mt-4 rounded-xl border border-sage/35 bg-sage/[0.045] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sage">
              {"◫"} Token & cost control
            </p>
            <p className="mt-1 font-sans text-[0.78rem] text-bone/65">
              Recorded spend by feature. Week starts Monday; month starts on the 1st.
            </p>
            {costPeriod ? (
              <p className="mt-1 font-mono text-[0.52rem] uppercase tracking-wider text-sage/80">
                {dateLabel(costPeriod.start)} to {dateLabel(costPeriod.end)}
              </p>
            ) : null}
          </div>
          <div className="flex overflow-hidden rounded-full border border-edge">
            {(["week", "month"] as const).map((m) => (
              <button
                key={`cost-panel-${m}`}
                type="button"
                onClick={() => setCostMode(m)}
                className={`px-3 py-1.5 font-mono text-[0.52rem] uppercase tracking-wider ${
                  costMode === m ? "bg-sage/15 text-sage" : "text-muted hover:text-bone"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="mb-2 flex items-end justify-between">
              <span className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">total</span>
              <span className="font-sans text-2xl tabular-nums text-sage">{dash ? gbp(costNow || 0) : "—"}</span>
            </div>
            <ul className="space-y-1.5">
              {(dash?.kpis.featureCosts || []).map((row) => {
                const value = costMode === "week" ? row.week : row.month;
                const total = Number(costNow) || 0;
                return (
                  <li key={row.feature}>
                    <div className="mb-0.5 flex items-center justify-between gap-3 font-mono text-[0.55rem]">
                      <span className="text-bone/70">{row.feature}</span>
                      <span className="tabular-nums text-muted">{gbp(value)}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-ink/70">
                      <div className="h-full rounded-full bg-sage/60" style={{ width: `${total ? Math.max(2, (value / total) * 100) : 0}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="mb-2 font-mono text-[0.54rem] uppercase tracking-wider text-muted">
              Live intelligence mode {modeSaving ? "· saving…" : ""}
            </p>
            <div className="grid gap-1.5">
              {(["economical", "balanced", "high"] as AiMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => chooseAiMode(mode)}
                  disabled={modeSaving}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    aiMode === mode
                      ? "border-sage/60 bg-sage/10"
                      : "border-edge bg-ink/30 hover:border-sage/40"
                  }`}
                >
                  <span className={`block font-mono text-[0.56rem] uppercase tracking-wider ${aiMode === mode ? "text-sage" : "text-bone/70"}`}>
                    {aiMode === mode ? "✓ " : ""}{mode === "high" ? "high intelligence" : mode}
                  </span>
                  <span className="mt-0.5 block font-sans text-[0.72rem] text-muted">{modeCopy[mode]}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 font-mono text-[0.5rem] leading-relaxed text-muted">
              Terra remains available in every mode. This changes cadence, not the quality of a requested cue.
            </p>
          </div>
        </div>
      </section>

      {/* The brain interviews you with a few questions each morning - answer by
          voice and it learns. Self-hides when there's nothing to ask. */}
      <MorningCheckin />

      {(dash?.dayParts?.length || dash?.dayRead) && (
        <div className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.06] p-4">
          <p className="mb-2 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-sky">
            {"▣"} Your day
          </p>
          {dash?.dayParts?.length ? (
            <ul className="flex flex-col gap-2">
              {dash.dayParts.map((p, i) => {
                // Every line leads somewhere: its client when we know it,
                // otherwise the to-do board so the segment is always actionable.
                const href = p.companyId
                  ? `/crm/${p.companyId}`
                  : "/crm/tasks";
                return (
                  <li
                    key={i}
                    className={`border-l-2 ${
                      p.time ? "border-amber/60" : "border-sky/40"
                    }`}
                  >
                    <Link
                      href={href}
                      className="group block rounded-md py-0.5 pl-3 transition hover:bg-bone/[0.04]"
                    >
                      <span className="font-sans text-sm leading-snug text-bone/85">
                        {p.time ? (
                          <span className="mr-1.5 rounded-full border border-amber/50 bg-amber/10 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-wider text-amber">
                            {p.time}
                          </span>
                        ) : null}
                        {p.label ? (
                          <span className="font-semibold text-bone">
                            {p.label}:{" "}
                          </span>
                        ) : null}
                        {capitaliseSentenceStarts(p.text)}
                        <span className="ml-1 font-mono text-[0.62rem] text-muted opacity-0 transition group-hover:opacity-100">
                          ↗
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="font-sans text-sm leading-relaxed text-bone/85">
              {capitaliseSentenceStarts(dash?.dayRead)}
            </p>
          )}
        </div>
      )}
      </> : null}

      {/* UPCOMING CALLS - the next seven days only, with schedule, prep and a
          preloaded start. The dedicated Calls page retains the longer view. */}
      <UpcomingCalls limit={focusMode ? 5 : 10} daysAhead={7} />

      <section className="mb-3 rounded-xl border border-amber/35 bg-panel/40 p-4">
        <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
              {"→"} Your task list
            </p>
            <p className="mt-1 font-sans text-[0.76rem] text-bone/65">
              Your top ten are shown first. Tick to complete, or expand the rest here.
            </p>
          </div>
          <Link
            href="/crm/tasks"
            className="font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            full task board ↗
          </Link>
        </div>
        <TaskList
          showCompany
          allowBulk
          initialLimit={10}
          emptyText="Nothing is waiting on you."
        />
      </section>

      {focusMode ? (
        <button
          type="button"
          onClick={() => setFocusMode(false)}
          className="mb-3 flex min-h-12 w-full items-center justify-between rounded-xl border border-edge bg-panel/30 px-4 py-3 text-left transition hover:border-amber/50"
        >
          <span>
            <span className="block font-mono text-[0.56rem] uppercase tracking-[0.18em] text-muted">
              Full workbench
            </span>
            <span className="mt-1 block font-sans text-[0.76rem] text-bone/65">
              Tasks, commitments, pipeline health, costs and recent calls.
            </span>
          </span>
          <span className="text-amber">＋</span>
        </button>
      ) : null}

      {!focusMode ? <>
      {/* You promised: commitments YOU made (calls + emails), each with a draft
          to approve. Self-hides when empty. */}
      <Commitments showCompany allowBulk />

      {/* Weekly spend flag: only shows when this week's all-in spend is over the
          guide, names the biggest driver and the monthly pace. */}
      {overGuide && (
        <div className="mb-3 rounded-xl border border-amber/50 bg-amber/[0.07] p-3">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
            {"⚠"} Spend flag
          </p>
          <p className="mt-1 font-sans text-[0.84rem] leading-snug text-bone/85">
            This week is {gbp(weekSpend)}, above your {gbp(WEEK_GUIDE_GBP)} guide.
            {driver ? ` Biggest driver: ${driver[0]} (${gbp(driver[1])}).` : ""} At
            this pace that is about {gbp(monthlyPace)} for the month.
          </p>
        </div>
      )}

      {/* OPPORTUNITIES: client work grouped by deal, coach-ranked, drag to
          reorder. Shows the top 10 with a "show all" expand. Each row expands to
          that client's to-dos. Self-hides when there are no client-linked to-dos. */}
      <OpportunityBoard />

      {/* WEEKLY RESET: a factual pipeline hygiene checklist assembled inside
          the existing dashboard read. No additional model or page request. */}
      {dash?.weeklyReview?.length ? (() => {
        const clear = dash.weeklyReview.filter((item) => item.count === 0).length;
        const total = dash.weeklyReview.length;
        return (
          <section className="mb-3 rounded-xl border border-sky/35 bg-sky/[0.045] p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
                  {"↻"} Weekly pipeline reset
                </p>
                <p className="mt-1 font-sans text-[0.76rem] text-bone/65">
                  Clear the loose ends, then start the next week with a trustworthy CRM.
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 font-mono text-[0.54rem] uppercase tracking-wider ${
                clear === total
                  ? "border-sage/45 bg-sage/10 text-sage"
                  : "border-sky/40 bg-sky/10 text-sky"
              }`}>
                {clear}/{total} clear
              </span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {dash.weeklyReview.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition ${
                    item.count === 0
                      ? "border-sage/25 bg-sage/[0.04] hover:border-sage/45"
                      : "border-edge bg-ink/35 hover:border-sky/50"
                  }`}
                >
                  <span className="font-sans text-[0.8rem] text-bone/80">
                    {item.label}
                  </span>
                  <span className={`font-mono text-[0.62rem] ${
                    item.count === 0 ? "text-sage" : "text-amber"
                  }`}>
                    {item.count === 0 ? "✓ clear" : `${item.count} fix`}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })() : null}

      {/* Data hygiene: only appears when two client records share a strong,
          deterministic identifier. Review-only; never auto-merges data. */}
      <DuplicateClients />

      {/* OVERALL STATS - each opens its drill-down board. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link href="/crm/board?tab=clients" className={statCls}>
          <div className="font-sans text-[1.2rem] text-bone">
            {dash?.kpis.clients ?? "—"}
          </div>
          <div className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
            clients ↗
          </div>
        </Link>
        <Link href="/crm/board?tab=opportunities" className={statCls}>
          <div className="font-sans text-[1.2rem] text-sage">
            {dash && dash.kpis.openOppValue > 0
              ? `£${Number(dash.kpis.openOppValue).toLocaleString()}`
              : dash?.kpis.openOppCount ?? "—"}
          </div>
          <div className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
            open value ↗
          </div>
        </Link>
        <Link href="/crm/tasks" className={statCls}>
          <div className="font-sans text-[1.2rem] text-bone">
            {dash?.kpis.tasks ?? "—"}
          </div>
          <div className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
            tasks to do ↗
          </div>
        </Link>
        <Link href="/crm/board?tab=drafts" className={statCls}>
          <div className="font-sans text-[1.2rem] text-bone">
            {dash?.kpis.drafts ?? "—"}
          </div>
          <div className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
            drafts to send ↗
          </div>
        </Link>
      </div>

      {/* RECENT (previous) CALLS - so a call is never lost. Unassigned ones get a
          one-click picker to put them under the right client. */}
      <RecentCalls />
      </> : null}

      <NavMenu />
    </main>
  );
}
