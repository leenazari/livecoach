"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";
import GlobalAssistant from "@/components/crm/GlobalAssistant";
import NavMenu from "@/components/crm/NavMenu";

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
  const [dash, setDash] = useState<Dash | null>(null);
  const [costMode, setCostMode] = useState<"week" | "month">("week");

  useEffect(() => {
    crmFetch<Dash>("/api/crm/dashboard")
      .then((d) => setDash(d))
      .catch(() => {});
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

      {dash && dash.tasks.length > 0 && (
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
          <ul className="flex flex-col">
            {dash.tasks.slice(0, 6).map((t, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 border-b border-edge/40 py-2 last:border-none"
              >
                <span className="mt-1 h-3 w-3 shrink-0 rounded border border-muted" />
                <span className="flex-1 font-sans text-[0.84rem] leading-snug text-bone">
                  {/* Clicking the task takes you to where you action it: a
                      draft opens the drafts list, anything else opens the
                      client to act on it. */}
                  <Link
                    href={
                      t.kind === "draft"
                        ? "/crm/board?tab=drafts"
                        : `/crm/${t.companyId}`
                    }
                    title={
                      t.kind === "draft"
                        ? "Open your drafts to send this"
                        : "Open this client to act on it"
                    }
                    className="text-bone transition hover:text-amber hover:underline"
                  >
                    {t.text}
                  </Link>{" "}
                  <Link
                    href={`/crm/${t.companyId}`}
                    className="font-mono text-[0.6rem] text-sky transition hover:text-amber"
                  >
                    · {t.company}
                  </Link>
                  {t.note && (
                    <span
                      className={`ml-1 font-mono text-[0.56rem] ${
                        t.kind === "draft" ? "text-sage" : "text-muted"
                      }`}
                    >
                      · {t.note}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* UPCOMING CALLS - needs calendar integration (next build). */}
      <div className="rounded-xl border border-edge bg-panel/40 p-4">
        <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"▦"} Upcoming calls
        </p>
        <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
          Connect your calendar to see scheduled calls here and prep them in
          advance. Calendar integration is the next build.
        </p>
      </div>

      <GlobalAssistant />
      <NavMenu />
    </main>
  );
}
