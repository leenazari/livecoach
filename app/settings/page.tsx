"use client";

import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";

export default function SettingsPage() {
  return (
    <main className="relative z-10 mx-auto max-w-[1000px] px-5 py-10">
      <header className="mb-5 flex items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / settings
          </span>
        </h1>
        <Link
          href="/crm"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ dashboard
        </Link>
      </header>

      <div className="rounded-xl border border-dashed border-edge p-8 text-center">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-bone">
          Settings
        </p>
        <p className="mt-1.5 font-mono text-[0.62rem] leading-relaxed text-muted">
          Account, calendar connection, and standard-field defaults will live
          here. Nothing to configure yet.
        </p>
      </div>

      <NavMenu />
    </main>
  );
}
