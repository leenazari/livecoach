"use client";

import Link from "next/link";

import NavMenu from "@/components/crm/NavMenu";
import TaskDashboard from "@/components/crm/TaskDashboard";

export default function TasksPage() {
  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-edge pb-4">
        <div>
          <h1 className="font-display text-[1.65rem] leading-none tracking-tight text-bone">
            <span className="italic text-amber">Live</span>Coach{" "}
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
              / tasks
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            One place for every task assigned to you. Changes made here update the same record everywhere in the CRM.
          </p>
        </div>
        <Link
          href="/crm"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ Today
        </Link>
      </header>

      <TaskDashboard />
      <NavMenu />
    </main>
  );
}
