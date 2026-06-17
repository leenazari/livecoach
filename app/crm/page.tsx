"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import UpcomingCalls from "@/components/crm/UpcomingCalls";
import TaskList from "@/components/crm/TaskList";
import Commitments from "@/components/crm/Commitments";
import MorningCheckin from "@/components/crm/MorningCheckin";
import RecentCalls from "@/components/crm/RecentCalls";
import OpportunityBoard from "@/components/crm/OpportunityBoard";

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

  useEffect(() => {
    let alive = true;
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

      {/* Commitments YOU made (calls + emails), each with a draft to approve.
          Self-hides when empty. */}
      <Commitments showCompany />

      {/* OPPORTUNITIES first: client work grouped by deal, coach-ranked, drag to
          reorder. Each row expands to that client's to-dos. Self-hides when
          there are no client-linked to-dos. */}
      <OpportunityBoard />

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
            under Opportunities above. Tick to complete, click to act. */}
        <TaskList
          hideCommitments
          clientlessOnly
          emptyText="Nothing loose. Your client work is grouped above."
        />
      </div>

      {/* UPCOMING CALLS first (what's ahead) - schedule, prep, start preloaded.
          (Google Calendar sync is the next phase.) */}
      <UpcomingCalls />

      {/* RECENT (previous) CALLS below - so a call is never lost. Unassigned ones
          get a one-click picker to put them under the right client. */}
      <RecentCalls />

      <NavMenu />
    </main>
  );
}
