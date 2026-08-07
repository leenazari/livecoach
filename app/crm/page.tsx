"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import UpcomingCalls from "@/components/crm/UpcomingCalls";
import TaskList from "@/components/crm/TaskList";
import Commitments from "@/components/crm/Commitments";
import MorningCheckin from "@/components/crm/MorningCheckin";
import RecentCalls from "@/components/crm/RecentCalls";
import OpportunityBoard from "@/components/crm/OpportunityBoard";
import DuplicateClients from "@/components/crm/DuplicateClients";
import CrmSearch from "@/components/crm/CrmSearch";

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
  entity?: "task";
};

type AiMode = "economical" | "balanced" | "high";

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
  const [modeSaving, setModeSaving] = useState(false);
  const [editingTodayId, setEditingTodayId] = useState<string | null>(null);
  const [editingTodayText, setEditingTodayText] = useState("");
  const [todaySavingId, setTodaySavingId] = useState<string | null>(null);
  const [todaySaveError, setTodaySaveError] = useState("");

  const refreshDashboard = useCallback(async () => {
    const next = await crmFetch<Dash>("/api/crm/dashboard?light=1");
    setDash((prev) =>
      prev
        ? { ...next, dayRead: prev.dayRead, dayParts: prev.dayParts }
        : next
    );
  }, []);

  const saveTodayTask = async (
    item: TodayItem,
    change: { text?: string; status?: "done" | "dismissed" }
  ) => {
    setTodaySaveError("");
    setTodaySavingId(item.id);
    try {
      await crmFetch(`/api/crm/tasks/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
      setEditingTodayId(null);
      await refreshDashboard();
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      setTodaySaveError("That change did not save. Please try again.");
    } finally {
      setTodaySavingId(null);
    }
  };

  useEffect(() => {
    let alive = true;
    // Self-heal: summarise any call the bot captured but that never got a
    // scorecard (e.g. the meeting just ended without pressing "End & summarise"),
    // so a captured call can't silently go missing from the lists. Fire and
    // forget, only does work when an orphan exists.
    fetch("/api/interview/backfill-scorecards").catch(() => {});
    // Tidy the to-do list: clear ones that have passed, fold loose ones into
    // the opportunity they're about, then refresh so both reflect.
    Promise.allSettled([
      fetch("/api/crm/tasks/sweep-stale"),
      fetch("/api/crm/tasks/fold-loose"),
    ]).then(() => window.dispatchEvent(new CustomEvent("lc:tasks-updated")));
    // Paint immediately from the light (no-AI) response, then fold in the
    // "Your day" blurb when the slower AI call returns - so the dashboard
    // never blocks on an LLM call.
    crmFetch<Dash>("/api/crm/dashboard?light=1")
      .then((d) => alive && setDash(d))
      .catch(() => {});
    crmFetch<Dash>("/api/crm/dashboard")
      .then(
        (d) =>
          alive &&
          setDash((prev) =>
            prev
              ? { ...prev, dayRead: d.dayRead, dayParts: d.dayParts }
              : d
          )
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshDashboard]);

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
      await crmFetch("/api/crm/ai-mode", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });
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
        .then((d) => setDash(d))
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
        <div className="flex items-center gap-3">
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

      {/* TODAY: the first decision layer, built from factual CRM state without
          another model call. The top three are deliberately first. */}
      <section className="mb-3 rounded-2xl border border-amber/45 bg-gradient-to-br from-amber/[0.09] to-transparent p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-amber">
              {"◆"} Today
            </p>
            <p className="mt-1 font-sans text-[0.8rem] text-bone/65">
              The three moves that need your attention first.
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
        {dash?.today?.topActions?.length ? (
          <ol className="mb-4 grid gap-2 md:grid-cols-3">
            {dash.today.topActions.map((item, i) => (
              <li key={`${item.reason}-${item.id}`}>
                <div className="group flex h-full flex-col rounded-xl border border-edge bg-ink/55 p-3 transition hover:border-amber/60">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[0.55rem] uppercase tracking-wider text-amber">
                      {i + 1}. {item.reason}
                    </span>
                    <span className="text-muted transition group-hover:text-amber">↗</span>
                  </div>
                  {editingTodayId === item.id ? (
                    <input
                      autoFocus
                      value={editingTodayText}
                      onChange={(e) => setEditingTodayText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingTodayId(null);
                      }}
                      onBlur={() => {
                        const text = editingTodayText.trim();
                        if (text && text !== item.text) saveTodayTask(item, { text });
                        else setEditingTodayId(null);
                      }}
                      className="w-full rounded-md border border-amber/50 bg-ink px-2 py-1 font-sans text-[0.86rem] text-bone outline-none"
                    />
                  ) : (
                    <Link href={item.href} className="font-sans text-[0.86rem] leading-snug text-bone hover:text-amber">
                      {item.text}
                    </Link>
                  )}
                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                      {item.company || "General"}
                      {item.at ? ` · ${shortDate(item.at)}` : ""}
                    </p>
                    {item.entity === "task" && (
                      <span className="flex items-center gap-1">
                        <button type="button" disabled={todaySavingId === item.id} onClick={() => { setEditingTodayId(item.id); setEditingTodayText(item.text); }} className="rounded px-2 py-1 font-mono text-[0.52rem] uppercase text-muted hover:text-amber disabled:opacity-40">edit</button>
                        <button type="button" disabled={todaySavingId === item.id} onClick={() => saveTodayTask(item, { status: "done" })} aria-label="Mark done" className="rounded px-2 py-1 font-mono text-[0.68rem] text-muted hover:text-sage disabled:opacity-40">✓</button>
                        <button type="button" disabled={todaySavingId === item.id} onClick={() => saveTodayTask(item, { status: "dismissed" })} aria-label="Delete point" className="rounded px-2 py-1 font-mono text-[0.68rem] text-muted hover:text-rust disabled:opacity-40">✕</button>
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mb-4 rounded-xl border border-sage/30 bg-sage/[0.06] p-3 font-sans text-sm text-sage">
            Nothing urgent is waiting. You are clear to focus on planned work.
          </p>
        )}
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
                  {items[0].company ? `${items[0].company}: ` : ""}{items[0].text}
                </Link>
              ) : (
                <span className="font-mono text-[0.56rem] text-muted">clear</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* COST CONTROL: true recorded spend, split by feature, plus a persisted
          live-intelligence cadence. Terra quality remains available in all modes. */}
      <section className="mb-3 rounded-xl border border-sage/35 bg-sage/[0.045] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sage">
              {"◫"} Token & cost control
            </p>
            <p className="mt-1 font-sans text-[0.78rem] text-bone/65">
              Recorded spend by feature. Choose how often live intelligence runs.
            </p>
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
                  : "/crm/board?tab=tasks";
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
                        {p.text}
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
              {dash?.dayRead}
            </p>
          )}
        </div>
      )}

      {/* UPCOMING CALLS - what's ahead, schedule + prep + start preloaded. Shows
          the soonest 10 with a "show all" expand to keep the dashboard condensed. */}
      <UpcomingCalls />

      <div className="mb-3 rounded-xl border border-edge bg-panel/40 p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
            {"→"} Do next
          </p>
          <Link
            href="/crm/board?tab=tasks"
            className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            see all ↗
          </Link>
        </div>
        {/* Loose, client-less to-dos only - the client-linked ones are grouped
            under Opportunities below. Tick to complete, click to act. */}
        <TaskList
          hideCommitments
          clientlessOnly
          emptyText="Nothing loose. Your client work is grouped below."
        />
      </div>

      {/* You promised: commitments YOU made (calls + emails), each with a draft
          to approve. Self-hides when empty. */}
      <Commitments showCompany />

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
        <Link href="/crm/board?tab=tasks" className={statCls}>
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

      <NavMenu />
    </main>
  );
}
