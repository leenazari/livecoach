"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MatrixRain from "@/components/MatrixRain";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";

type CrmNotification = {
  id: string;
  kind: "outreach_reply" | "lead_assigned";
  title: string;
  body: string;
  href: string | null;
  sourceTable: string;
  sourceId: string;
  readAt: string | null;
  createdAt: string;
};

type NotificationFeed = {
  notifications: CrmNotification[];
  unreadCount: number;
  currentUser: string;
  serverTime: string;
};

type Filter = "unread" | "all";
type BrowserPermission = NotificationPermission | "unsupported";

const button =
  "min-h-11 rounded-lg border border-edge px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-wait disabled:opacity-45";
const primary =
  "min-h-11 rounded-lg border border-amber/55 bg-amber/10 px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-wait disabled:opacity-45";

const formatWhen = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export default function NotificationsPage() {
  const router = useRouter();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [filter, setFilter] = useState<Filter>("unread");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [permission, setPermission] = useState<BrowserPermission>("unsupported");

  const load = useCallback(async () => {
    try {
      const next = await crmFetch<NotificationFeed>(
        "/api/crm/notifications?limit=100"
      );
      setFeed(next);
      setError("");
    } catch (reason: any) {
      setError(reason?.message || "Notifications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPermission(
      "Notification" in window ? Notification.permission : "unsupported"
    );
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("lc:notifications-updated", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("lc:notifications-updated", refresh);
    };
  }, [load]);

  const visible = useMemo(() => {
    const items = feed?.notifications || [];
    return filter === "unread" ? items.filter((item) => !item.readAt) : items;
  }, [feed?.notifications, filter]);

  const enableDesktop = async () => {
    if (!("Notification" in window)) return;
    try {
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next === "granted") {
        const popup = new Notification("LiveCoach notifications are on", {
          body: "New replies and leads assigned to you can now appear on this desktop.",
          tag: "livecoach-notifications-enabled",
          icon: "/favicon.ico",
        });
        window.setTimeout(() => popup.close(), 5_000);
      }
    } catch {
      setError(
        "This browser could not enable desktop popups. In-app notifications will still work."
      );
    }
  };

  const updateOne = async (
    notification: CrmNotification,
    action: "read" | "unread" | "dismiss"
  ) => {
    setBusy(notification.id);
    setError("");
    try {
      await crmFetch(`/api/crm/notifications/${notification.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
      await load();
    } catch (reason: any) {
      setError(reason?.message || "The notification could not be updated.");
    } finally {
      setBusy("");
    }
  };

  const markAllRead = async () => {
    setBusy("all");
    setError("");
    try {
      await crmFetch("/api/crm/notifications", {
        method: "PATCH",
        body: JSON.stringify({ action: "read_all" }),
      });
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
      await load();
    } catch (reason: any) {
      setError(reason?.message || "Notifications could not be marked as read.");
    } finally {
      setBusy("");
    }
  };

  const openSource = async (notification: CrmNotification) => {
    if (!notification.readAt) {
      try {
        await crmFetch(`/api/crm/notifications/${notification.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "read" }),
        });
        window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
      } catch {
        // Opening the canonical source is still useful if the receipt update fails.
      }
    }
    router.push(notification.href || "/crm/notifications");
  };

  const permissionStyle =
    permission === "granted"
      ? "border-moss/40 bg-moss/[0.08] text-moss"
      : permission === "denied"
        ? "border-rust/45 bg-rust/[0.08] text-rust"
        : "border-sky/40 bg-sky/[0.08] text-sky";

  return (
    <main className="relative z-10 mx-auto max-w-[1080px] px-3 py-5 pb-24 sm:px-5 sm:py-9 sm:pb-12">
      <NavMenu />
      <header className="mb-4 flex flex-col gap-3 border-b border-edge pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
            Personal sales alerts
          </p>
          <h1 className="mt-1 font-display text-[1.7rem] tracking-tight text-bone sm:text-3xl">
            Your <span className="italic text-amber">notifications</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            New outreach replies and leads assigned to you. Each teammate has a separate private unread list.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={!feed?.unreadCount || !!busy}
          className={`${button} w-full sm:w-auto`}
        >
          {busy === "all" ? "Saving…" : "Mark all read"}
        </button>
      </header>

      <section className={`mb-4 rounded-xl border p-4 ${permissionStyle}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[0.58rem] uppercase tracking-wider">
              Desktop popups
            </p>
            <p className="mt-1 text-sm leading-6">
              {permission === "granted"
                ? "Enabled in this browser."
                : permission === "denied"
                  ? "Blocked in this browser. Allow notifications for LiveCoach in your browser site settings."
                  : permission === "unsupported"
                    ? "This browser does not support desktop notifications."
                    : "Optional. Enable popups for new replies and newly assigned leads."}
            </p>
            <p className="mt-1 text-xs opacity-80">
              Popups work while your browser is running. Your in-app history remains here either way.
            </p>
          </div>
          {permission === "default" ? (
            <button
              type="button"
              onClick={() => void enableDesktop()}
              className={`${primary} w-full shrink-0 sm:w-auto`}
            >
              Enable desktop popups
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <section className="mb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setFilter("unread")}
          className={`rounded-xl border p-3 text-left transition ${
            filter === "unread"
              ? "border-amber/60 bg-amber/10"
              : "border-edge bg-panel hover:border-amber/40"
          }`}
        >
          <strong className="block font-display text-2xl text-bone">
            {feed?.unreadCount || 0}
          </strong>
          <span className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">
            Unread
          </span>
        </button>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-xl border p-3 text-left transition ${
            filter === "all"
              ? "border-amber/60 bg-amber/10"
              : "border-edge bg-panel hover:border-amber/40"
          }`}
        >
          <strong className="block font-display text-2xl text-bone">
            {feed?.notifications.length || 0}
          </strong>
          <span className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">
            Recent history
          </span>
        </button>
      </section>

      {loading && !feed ? (
        <MatrixRain
          size="panel"
          messages={["loading your alerts", "checking new replies", "checking assigned leads"]}
        />
      ) : visible.length ? (
        <section className="space-y-2">
          {visible.map((notification) => {
            const unread = !notification.readAt;
            return (
              <article
                key={notification.id}
                className={`rounded-xl border p-4 ${
                  unread
                    ? "border-amber/50 bg-amber/[0.07]"
                    : "border-edge bg-panel"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      unread ? "bg-amber shadow-[0_0_12px_currentColor]" : "bg-edge"
                    }`}
                    aria-label={unread ? "Unread" : "Read"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                          {notification.kind === "outreach_reply"
                            ? "Outreach reply"
                            : "Lead assignment"}
                        </p>
                        <h2 className="mt-1 text-base font-medium text-bone">
                          {notification.title}
                        </h2>
                      </div>
                      <time className="font-mono text-[0.5rem] uppercase text-muted">
                        {formatWhen(notification.createdAt)}
                      </time>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-bone/80">
                      {notification.body}
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() => void openSource(notification)}
                        disabled={busy === notification.id}
                        className={`${primary} w-full sm:w-auto`}
                      >
                        Open in CRM
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateOne(notification, unread ? "read" : "unread")
                        }
                        disabled={busy === notification.id}
                        className={`${button} w-full sm:w-auto`}
                      >
                        {unread ? "Mark read" : "Mark unread"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateOne(notification, "dismiss")}
                        disabled={busy === notification.id}
                        className="min-h-11 w-full rounded-lg px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-muted hover:bg-rust/10 hover:text-rust disabled:opacity-45 sm:w-auto"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-edge bg-panel/60 px-5 py-14 text-center">
          <p className="font-display text-xl text-bone">
            {filter === "unread" ? "You are all caught up." : "No notifications yet."}
          </p>
          <p className="mt-2 text-sm text-muted">
            New replies and newly assigned leads will appear here automatically.
          </p>
        </section>
      )}
    </main>
  );
}
