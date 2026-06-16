"use client";

import Link from "next/link";
import ClientAssistant from "@/components/crm/ClientAssistant";

// Dedicated mobile page: open it on your phone, talk to the brain on the go, and
// ask it to do things (add a to-do, attach a link, dismiss something). It mounts
// the GLOBAL brain (knows your whole book) and starts listening straight away.
// The rest of the site isn't mobile-tuned yet - this is the on-the-go surface.
export default function TalkPage() {
  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[560px] flex-col bg-ink px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl leading-none tracking-tight text-bone">
            <span className="italic text-amber">Live</span>Coach
          </h1>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-muted">
            talk to the brain
          </p>
        </div>
        <Link
          href="/crm"
          className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          dashboard
        </Link>
      </div>

      {/* The brain fills the screen. autoListen starts the mic on open so you can
          just start talking. Hands-free and read-aloud are on by default. */}
      <div className="flex min-h-0 flex-1">
        <ClientAssistant autoListen />
      </div>
    </main>
  );
}
