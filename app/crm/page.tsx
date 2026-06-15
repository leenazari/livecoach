"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import UpcomingCalls from "@/components/crm/UpcomingCalls";
import TaskList from "@/components/crm/TaskList";

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
  };
  tasks: {
    text: string;
    company: string;
    companyId: string;
    kind: string;
    note?: string;
  }[];
  dayRead: string;
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
          setDash((prev) => (prev ? { ...prev, dayRead: d.dayRead } : d))
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
          <Link
            href="/call"
            className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
          >
            ◂ back to a call
          </Link>
        </div>
      </header>

      {dash?.dayRead && (
        <div className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.06] p-4">
          <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-sky">
            {"▣"} Your day
          </p>
          <p className="font-sans text-sm leading-relaxed text-bone/85">
            {dash.dayRead}
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
        {/* Tick to complete, click a ticked task to remove. Done tasks clear on
            their own the next day. Click the text to start the action. */}
        <TaskList showCompany emptyText="Nothing on your plate. Nice." />
      </div>

      {/* UPCOMING CALLS - schedule, prep in advance, start preloaded.
          (Google Calendar sync is the next phase.) */}
      <UpcomingCalls />

      <NavMenu />
    </main>
  );
}
