"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

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

export default function NavMenu() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [minimised, setMinimised] = useState(false);
  const [tab, setTab] = useState("");
  const [ready, setReady] = useState(false);

  // Restore the open/minimised preference.
  useEffect(() => {
    try {
      setMinimised(localStorage.getItem("lc_nav_min") === "1");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // Track the board tab (for highlighting Clients / To do / Drafts).
  useEffect(() => {
    if (typeof window !== "undefined") {
      setTab(new URLSearchParams(window.location.search).get("tab") || "");
    }
  }, [pathname]);

  // Push page content right while open; remember the choice.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem("lc_nav_min", minimised ? "1" : "0");
    } catch {
      /* ignore */
    }
    document.body.style.transition = "padding-left .2s ease";
    document.body.style.paddingLeft = minimised ? "" : SIDEBAR_W;
  }, [minimised, ready]);

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
        {/* Go back one step in history, wherever you came from. */}
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider text-muted transition hover:bg-bone/[0.05] hover:text-bone"
        >
          <span className="w-4 text-center">←</span>
          Back
        </button>
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
