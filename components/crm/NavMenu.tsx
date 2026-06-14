"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// A slide-in side menu so you can move between the main areas from anywhere.
// Triggered by a button bottom-left (the assistant lives bottom-right). For a
// permanent fixed sidebar on every screen, this belongs in app/layout.tsx.
const LINKS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/crm", label: "Dashboard", match: (p) => p === "/crm" },
  {
    href: "/crm/board?tab=clients",
    label: "Clients",
    match: (p) => p.startsWith("/crm/board"),
  },
  {
    href: "/crm/board?tab=tasks",
    label: "Tasks to do",
    match: () => false,
  },
  {
    href: "/crm/board?tab=drafts",
    label: "Drafts",
    match: () => false,
  },
  { href: "/call", label: "Set up a call", match: (p) => p.startsWith("/call") },
];

export default function NavMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Menu"
        className="fixed bottom-6 left-6 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-panel text-bone shadow-lg transition hover:border-amber/60 hover:text-amber"
      >
        <span className="text-lg leading-none">☰</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-ink/70"
            onClick={() => setOpen(false)}
          />
          <nav className="relative flex h-full w-[min(280px,82vw)] flex-col gap-1 border-r border-edge bg-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-[1.2rem] tracking-tight text-bone">
                <span className="italic text-amber">Live</span>Coach
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="font-mono text-sm text-muted transition hover:text-bone"
              >
                ✕
              </button>
            </div>
            {LINKS.map((l) => {
              const active = l.match(pathname);
              return (
                <Link
                  key={l.href + l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-lg px-3 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider transition ${
                    active
                      ? "bg-amber/15 text-amber"
                      : "text-muted hover:bg-bone/[0.05] hover:text-bone"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
