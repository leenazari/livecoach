"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Persistent left sidebar, OPEN by default. Minimise collapses it to a ☰ button;
// the choice is remembered (localStorage). When open it pushes the page content
// right by padding the body, so nothing is hidden behind it.
type Item = { href: string; label: string; icon: string; tab?: string };
const ITEMS: Item[] = [
  { href: "/crm", label: "Dashboard", icon: "▣" },
  { href: "/call", label: "Start new call", icon: "▸" },
  { href: "/crm/board?tab=clients", label: "Clients", icon: "◴", tab: "clients" },
  { href: "/crm/board?tab=tasks", label: "To do", icon: "→", tab: "tasks" },
  { href: "/crm/board?tab=drafts", label: "Drafts", icon: "✉", tab: "drafts" },
  { href: "/crm/calls", label: "Calls", icon: "☎" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

const SIDEBAR_W = "15rem";

function NavMenuInner() {
  const pathname = usePathname() || "";
  const router = useRouter();
  // useSearchParams updates on query-only navigation (e.g. switching board
  // tabs), so the active highlight follows instantly instead of sticking.
  const tab = useSearchParams().get("tab") || "";
  // Read the open/minimised preference synchronously so there's no open->
  // minimised flash on every page mount.
  const [minimised, setMinimised] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("lc_nav_min") === "1";
    } catch {
      return false;
    }
  });

  // Push page content right while open; remember the choice. Apply INSTANTLY
  // (no CSS transition) - a transition could be caught half-finished when you
  // navigate quickly, leaving the sidebar/content looking stuck.
  useEffect(() => {
    try {
      localStorage.setItem("lc_nav_min", minimised ? "1" : "0");
    } catch {
      /* ignore */
    }
    document.body.style.transition = "";
    document.body.style.paddingLeft = minimised ? "" : SIDEBAR_W;
  }, [minimised]);

  // Open the brain chat from the menu. On phones the open sidebar would sit on
  // top of the chat, so collapse it as we open.
  const openBrain = () => {
    window.dispatchEvent(new CustomEvent("lc:open-brain"));
    if (typeof window !== "undefined" && window.innerWidth < 640) setMinimised(true);
  };

  const isActive = (it: Item) => {
    if (it.href === "/crm") return pathname === "/crm";
    if (it.href === "/call") return pathname.startsWith("/call");
    if (it.href === "/crm/calls") return pathname.startsWith("/crm/calls");
    if (it.href === "/settings") return pathname.startsWith("/settings");
    if (it.tab) return pathname.startsWith("/crm/board") && tab === it.tab;
    return false;
  };

  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => setMinimised(false)}
        title="Open menu"
        className="fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-panel text-bone shadow-lg transition hover:border-amber/60 hover:text-amber"
      >
        <span className="text-lg leading-none">☰</span>
      </button>
    );
  }

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-full w-60 flex-col border-r border-edge bg-panel">
      <div className="flex items-center justify-between px-5 py-4">
        <span className="font-display text-[1.15rem] tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach
        </span>
        <button
          type="button"
          onClick={() => setMinimised(true)}
          title="Minimise menu"
          className="font-mono text-lg leading-none text-muted transition hover:text-bone"
        >
          «
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {/* Open the brain chat panel from anywhere in the CRM. */}
        <button
          type="button"
          onClick={openBrain}
          className="mb-1 flex items-center gap-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
        >
          <span className="w-4 text-center">▤</span>
          Talk to brain
        </button>
        {/* Go back one step in history - but NOT on the dashboard, which is the
            CRM home, there's nowhere to go back to from there. */}
        {pathname !== "/crm" && (
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider text-muted transition hover:bg-bone/[0.05] hover:text-bone"
          >
            <span className="w-4 text-center">←</span>
            Back
          </button>
        )}
        {ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider transition ${
              isActive(it)
                ? "bg-amber/15 text-amber"
                : "text-muted hover:bg-bone/[0.05] hover:text-bone"
            }`}
          >
            <span className="w-4 text-center">{it.icon}</span>
            {it.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-edge px-3 py-3">
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider text-muted transition hover:bg-rust/10 hover:text-rust"
        >
          <span className="w-4 text-center">⎋</span>
          Logout
        </button>
      </div>
    </aside>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function NavMenu() {
  return (
    <Suspense fallback={null}>
      <NavMenuInner />
    </Suspense>
  );
}
