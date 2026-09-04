"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { clearCrmCache, crmFetch, getCached } from "@/lib/crm";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationAlerts from "@/components/crm/NotificationAlerts";
import LiveCoachLogo from "@/components/LiveCoachLogo";

// Persistent left sidebar, OPEN by default. Minimise collapses it to a ☰ button;
// the choice is remembered (localStorage). When open it pushes the page content
// right by padding the body, so nothing is hidden behind it.
type Item = { href: string; label: string; icon: string; tab?: string };
type ViewerRole = "owner" | "manager" | "sales";
type TeamStatus = { role?: ViewerRole };

const TEAM_STATUS_URL = "/api/auth/team/status";
const OUTREACH_ITEM: Item = { href: "/crm/outreach", label: "Outreach", icon: "↗" };
const SALES_OUTREACH_ITEM: Item = {
  href: "/crm/outreach?tab=prospects",
  label: "Outreach",
  icon: "↗",
};
const NOTIFICATIONS_ITEM: Item = {
  href: "/crm/notifications",
  label: "Notifications",
  icon: "●",
};
const CHAT_ITEM: Item = {
  href: "/crm/chat",
  label: "Team chat",
  icon: "◫",
};
const BRAIN_CONTROL_ITEM: Item = {
  href: "/crm/brain-control",
  label: "Brain control",
  icon: "◎",
};
const PIPELINE_ITEM: Item = { href: "/crm/revenue", label: "Pipeline", icon: "◆" };
const TASKS_ITEM: Item = { href: "/crm/tasks", label: "Tasks", icon: "☑" };
const CLIENTS_ITEM: Item = { href: "/crm/board?tab=clients", label: "Clients", icon: "◴", tab: "clients" };
const CALLS_ITEM: Item = { href: "/crm/calls", label: "Calls", icon: "☎" };
const PLAYBOOK_ITEM: Item = { href: "/crm/pitch-playbook", label: "Sales knowledge", icon: "◇" };
const COSTS_ITEM: Item = { href: "/crm/costs", label: "Costs", icon: "£" };
const DOCUMENTS_ITEM: Item = { href: "/crm/documents", label: "Documents", icon: "▤" };
const OWNER_CORE_ITEMS: Item[] = [
  PIPELINE_ITEM,
  CLIENTS_ITEM,
  CALLS_ITEM,
  PLAYBOOK_ITEM,
  COSTS_ITEM,
  DOCUMENTS_ITEM,
];
const SALES_CORE_ITEMS: Item[] = [
  SALES_OUTREACH_ITEM,
  BRAIN_CONTROL_ITEM,
  PIPELINE_ITEM,
  CLIENTS_ITEM,
];
const MORE_ITEMS: Item[] = [
  { href: "/crm/call-coach", label: "Call coach", icon: "◎" },
  { href: "/crm/health", label: "Health", icon: "✓" },
  { href: "/settings/readiness", label: "Account readiness", icon: "◌" },
  { href: "/settings/sales-profile", label: "My setup", icon: "◉" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];
const START_ITEM: Item = { href: "/call", label: "Start new call", icon: "▸" };

const SIDEBAR_W = "15rem";

function NavMenuInner({
  notificationCount,
  chatUnreadCount,
}: {
  notificationCount: number;
  chatUnreadCount: number;
}) {
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
  const [mobileMore, setMobileMore] = useState(false);
  const [desktopMore, setDesktopMore] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [viewerRole, setViewerRole] = useState<ViewerRole | null>(() => {
    const cached = getCached<TeamStatus>(TEAM_STATUS_URL);
    return cached?.role || null;
  });

  useEffect(() => {
    let active = true;
    void crmFetch<TeamStatus>(TEAM_STATUS_URL)
      .then((status) => {
        if (active && status.role) setViewerRole(status.role);
      })
      .catch(() => {
        // Navigation still works with the safe salesperson home fallback.
      });
    return () => {
      active = false;
    };
  }, []);

  // Sales and manager accounts land on their prioritised Work Inbox. Owners
  // retain the wider executive dashboard and a separate Work Inbox link.
  const salesHome = viewerRole !== "owner";
  const homeItem: Item = salesHome
    ? { href: "/crm/inbox", label: "Today", icon: "▣" }
    : { href: "/crm", label: "Today", icon: "▣" };
  const coreItems: Item[] = salesHome
    ? [homeItem, TASKS_ITEM, CHAT_ITEM, ...SALES_CORE_ITEMS, NOTIFICATIONS_ITEM]
    : [
        homeItem,
        TASKS_ITEM,
        CHAT_ITEM,
        NOTIFICATIONS_ITEM,
        { href: "/crm/inbox", label: "Sales Today", icon: "✓" },
        OUTREACH_ITEM,
        BRAIN_CONTROL_ITEM,
        ...OWNER_CORE_ITEMS,
      ];
  const moreItems = salesHome
    ? [CALLS_ITEM, PLAYBOOK_ITEM, DOCUMENTS_ITEM, COSTS_ITEM, ...MORE_ITEMS]
    : MORE_ITEMS;
  const allItems = [...coreItems, START_ITEM, ...moreItems];

  // Phone layout: a thumb-reachable bottom tab bar instead of the left sidebar.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

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
    if (mobile) {
      // Phone: no left push, just room at the bottom for the tab bar.
      document.body.classList.add("lc-mobile-nav");
      document.body.style.paddingLeft = "";
      document.body.style.paddingBottom = "4.75rem";
    } else {
      document.body.classList.remove("lc-mobile-nav");
      document.body.style.paddingBottom = "";
      document.body.style.paddingLeft = minimised ? "" : SIDEBAR_W;
    }
    return () => {
      document.body.classList.remove("lc-mobile-nav");
      document.body.style.paddingLeft = "";
      document.body.style.paddingBottom = "";
    };
  }, [minimised, mobile]);

  // Open the brain chat from the menu. On phones the open sidebar would sit on
  // top of the chat, so collapse it as we open.
  const openBrain = () => {
    window.dispatchEvent(new CustomEvent("lc:open-brain"));
    if (typeof window !== "undefined" && window.innerWidth < 640) setMinimised(true);
  };

  const openSalesTutorial = () => {
    window.dispatchEvent(new CustomEvent("lc:start-sales-tutorial"));
    setMobileMore(false);
  };

  const openSendPilotTutorial = () => {
    window.dispatchEvent(new CustomEvent("lc:start-sendpilot-tutorial"));
    setMobileMore(false);
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      clearCrmCache();
      await createSupabaseBrowser().auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  const isActive = (it: Item) => {
    if (it.href === "/crm") return pathname === "/crm";
    if (it.href === "/crm/tasks") return pathname.startsWith("/crm/tasks");
    if (it.href === "/call") return pathname.startsWith("/call");
    if (it.href === "/crm/inbox") return pathname.startsWith("/crm/inbox");
    if (it.href === "/crm/notifications")
      return pathname.startsWith("/crm/notifications");
    if (it.href === "/crm/chat") return pathname.startsWith("/crm/chat");
    if (it.href === "/crm/brain-control")
      return pathname.startsWith("/crm/brain-control");
    if (it.href === "/crm/documents")
      return pathname.startsWith("/crm/documents");
    if (it.href === "/crm/revenue")
      return pathname.startsWith("/crm/revenue");
    if (it.href === "/crm/costs")
      return pathname.startsWith("/crm/costs");
    if (it.href === "/crm/call-coach")
      return pathname.startsWith("/crm/call-coach");
    if (it.href === "/crm/health")
      return pathname.startsWith("/crm/health");
    if (it.href.startsWith("/crm/outreach"))
      return pathname.startsWith("/crm/outreach");
    if (it.href === "/crm/calls")
      return pathname.startsWith("/crm/calls") &&
        !pathname.startsWith("/crm/call-coach");
    if (it.href === "/crm/pitch-playbook")
      return pathname.startsWith("/crm/pitch-playbook");
    if (it.href === "/settings/sales-profile")
      return pathname.startsWith("/settings/sales-profile");
    if (it.href === "/settings/readiness")
      return pathname.startsWith("/settings/readiness");
    if (it.href === "/settings")
      return pathname.startsWith("/settings") &&
        !pathname.startsWith("/settings/sales-profile") &&
        !pathname.startsWith("/settings/readiness");
    if (it.tab) return pathname.startsWith("/crm/board") && tab === it.tab;
    return false;
  };

  // PHONE: a bottom tab bar with the five core destinations, the central
  // "Start" lifted like a call-to-action. The brain chat stays reachable via
  // its own floating button (nudged up on mobile so it clears this bar).
  if (mobile) {
    const BOTTOM: Item[] = [
      salesHome
        ? SALES_OUTREACH_ITEM
        : OUTREACH_ITEM,
      homeItem,
      { href: "/call", label: "Start", icon: "▸" },
      TASKS_ITEM,
    ];
    return (
      <>
        {mobileMore && (
          <div className="fixed inset-0 z-[49] flex items-end bg-ink/70 px-3 pb-20 backdrop-blur-sm" onClick={() => setMobileMore(false)}>
            <div className="w-full rounded-2xl border border-edge bg-panel p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center justify-between px-2">
                <span className="font-mono text-[0.62rem] uppercase tracking-wider text-amber">More</span>
                <button type="button" onClick={() => setMobileMore(false)} aria-label="Close more menu" className="h-11 w-11 rounded-full text-muted">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {allItems.filter((item) => !BOTTOM.some((b) => b.href === item.href) && item.href !== "/call").map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setMobileMore(false)} className="flex min-h-12 items-center gap-3 rounded-xl border border-edge bg-ink/40 px-3 font-mono text-[0.62rem] uppercase tracking-wider text-bone">
                    <span className="text-amber">{item.icon}</span>
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {item.href === NOTIFICATIONS_ITEM.href && notificationCount > 0 ? (
                      <span className="rounded-full bg-rust px-2 py-0.5 text-[0.5rem] text-bone">
                        {notificationCount > 99 ? "99+" : notificationCount}
                      </span>
                    ) : null}
                    {item.href === CHAT_ITEM.href && chatUnreadCount > 0 ? (
                      <span className="rounded-full bg-amber px-2 py-0.5 text-[0.5rem] text-ink">
                        {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                      </span>
                    ) : null}
                  </Link>
                ))}
                <button type="button" onClick={() => { setMobileMore(false); openBrain(); }} className="flex min-h-12 items-center gap-3 rounded-xl border border-amber/40 bg-amber/10 px-3 text-left font-mono text-[0.62rem] uppercase tracking-wider text-amber">
                  <span>▤</span>Talk to brain
                </button>
                <button type="button" onClick={openSalesTutorial} className="flex min-h-12 items-center gap-3 rounded-xl border border-sage/40 bg-sage/10 px-3 text-left font-mono text-[0.62rem] uppercase tracking-wider text-sage">
                  <span>?</span>Sales tutorial
                </button>
                <button type="button" onClick={openSendPilotTutorial} className="flex min-h-12 items-center gap-3 rounded-xl border border-sky/40 bg-sky/10 px-3 text-left font-mono text-[0.62rem] uppercase tracking-wider text-sky">
                  <span>↗</span>SendPilot guide
                </button>
                <ThemeToggle className="min-h-12 justify-start" />
                <button type="button" onClick={logout} disabled={loggingOut} className="flex min-h-12 items-center gap-3 rounded-xl border border-edge bg-ink/40 px-3 text-left font-mono text-[0.62rem] uppercase tracking-wider text-muted disabled:opacity-50">
                  <span>⎋</span>{loggingOut ? "Signing out…" : "Logout"}
                </button>
              </div>
            </div>
          </div>
        )}
        <nav
          aria-label="Main navigation"
          className="fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-around border-t border-edge bg-panel/95 backdrop-blur"
          style={{ paddingBottom: "max(0.2rem, env(safe-area-inset-bottom))" }}
        >
          {BOTTOM.map((t) => {
            const active = isActive(t);
            const center = t.href === "/call";
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-end gap-1 py-2 font-mono text-[0.55rem] uppercase tracking-wider transition ${
                  active ? "text-amber" : "text-muted"
                }`}
              >
                <span className={center ? "-mt-3 flex h-11 w-11 items-center justify-center rounded-full border border-amber/60 bg-amber/20 text-[1.1rem] leading-none text-amber" : "text-[1.05rem] leading-none"}>
                  {t.icon}
                </span>
                {t.label}
              </Link>
            );
          })}
          <button type="button" onClick={() => setMobileMore(true)} aria-expanded={mobileMore} className={`relative flex min-h-14 flex-1 flex-col items-center justify-end gap-1 py-2 font-mono text-[0.55rem] uppercase tracking-wider ${mobileMore ? "text-amber" : "text-muted"}`}>
            {notificationCount > 0 ? (
              <span className="absolute right-[28%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[0.45rem] text-bone">
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            ) : null}
            <span className="text-[1.05rem] leading-none">•••</span>More
          </button>
        </nav>
      </>
    );
  }

  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => setMinimised(false)}
        title="Open menu"
        className="fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-panel text-bone shadow-lg transition hover:border-amber/60 hover:text-amber"
      >
        <span className="text-lg leading-none">☰</span>
        {notificationCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1 font-mono text-[0.48rem] text-bone">
            {notificationCount > 9 ? "9+" : notificationCount}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-full w-60 flex-col border-r border-edge bg-panel">
      <div className="flex items-center justify-between px-5 py-4">
        <LiveCoachLogo markClassName="h-8 w-8" wordmarkClassName="font-display text-[1.15rem] tracking-tight" />
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
        <Link
          href="/call"
          aria-current={isActive(START_ITEM) ? "page" : undefined}
          className={`mb-1 flex items-center gap-3 rounded-lg border px-3 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider transition ${
            isActive(START_ITEM)
              ? "border-sage/55 bg-sage/10 text-sage"
              : "border-edge text-bone hover:border-sage/45 hover:bg-sage/[0.06]"
          }`}
        >
          <span className="w-4 text-center">▸</span>
          Start new call
        </Link>
        <div className="mt-2">
          <p className="mb-1 px-3 font-mono text-[0.48rem] uppercase tracking-[0.18em] text-muted/60">Work</p>
          {coreItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-current={isActive(it) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider transition ${
                isActive(it)
                  ? "bg-amber/15 text-amber"
                  : "text-muted hover:bg-bone/[0.05] hover:text-bone"
              }`}
            >
              <span className="w-4 text-center">{it.icon}</span>
              <span className="min-w-0 flex-1">{it.label}</span>
              {it.href === NOTIFICATIONS_ITEM.href && notificationCount > 0 ? (
                <span className="rounded-full bg-rust px-2 py-0.5 text-[0.5rem] text-bone">
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span>
              ) : null}
              {it.href === CHAT_ITEM.href && chatUnreadCount > 0 ? (
                <span className="rounded-full bg-amber px-2 py-0.5 text-[0.5rem] text-ink">
                  {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
        <div className="mt-3 border-t border-edge/70 pt-2">
          <button
            type="button"
            onClick={() => setDesktopMore((open) => !open)}
            aria-expanded={desktopMore || moreItems.some(isActive)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:bg-bone/[0.05] hover:text-bone"
          >
            <span>More tools</span>
            <span>{desktopMore || moreItems.some(isActive) ? "−" : "+"}</span>
          </button>
          {(desktopMore || moreItems.some(isActive)) ? (
            <div className="mt-1">
              {moreItems.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={isActive(it) ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider transition ${
                    isActive(it)
                      ? "bg-amber/15 text-amber"
                      : "text-muted hover:bg-bone/[0.05] hover:text-bone"
                  }`}
                >
                  <span className="w-4 text-center">{it.icon}</span>
                  {it.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={openSalesTutorial}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-sage transition hover:bg-sage/10"
              >
                <span className="w-4 text-center">?</span>
                Sales tutorial
              </button>
              <button
                type="button"
                onClick={openSendPilotTutorial}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-sky transition hover:bg-sky/10"
              >
                <span className="w-4 text-center">↗</span>
                SendPilot guide
              </button>
            </div>
          ) : null}
        </div>
      </nav>

      <div className="border-t border-edge px-3 py-3">
        <ThemeToggle className="mb-1 w-full justify-start" />
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-[0.68rem] uppercase tracking-wider text-muted transition hover:bg-rust/10 hover:text-rust"
        >
          <span className="w-4 text-center">⎋</span>
          {loggingOut ? "Signing out…" : "Logout"}
        </button>
      </div>
    </aside>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function NavMenu() {
  const [notificationCount, setNotificationCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  return (
    <>
      <NotificationAlerts
        onUnreadCount={setNotificationCount}
        onChatUnreadCount={setChatUnreadCount}
      />
      <Suspense fallback={null}>
        <NavMenuInner
          notificationCount={notificationCount}
          chatUnreadCount={chatUnreadCount}
        />
      </Suspense>
    </>
  );
}
