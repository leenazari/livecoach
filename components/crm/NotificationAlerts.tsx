"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";

type CrmNotification = {
  id: string;
  kind: "outreach_reply" | "lead_assigned";
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationFeed = {
  notifications: CrmNotification[];
  unreadCount: number;
  currentUser: string;
  serverTime: string;
};

const POLL_MS = 60_000;
const LAST_POPUP_KEY = "livecoach:notifications:last-popup:v1";

export default function NotificationAlerts({
  onUnreadCount,
}: {
  onUnreadCount: (count: number) => void;
}) {
  const [toasts, setToasts] = useState<CrmNotification[]>([]);
  const loading = useRef(false);
  const popupCursor = useRef(new Map<string, string>());

  const openNotification = useCallback(async (notification: CrmNotification) => {
    setToasts((current) => current.filter((item) => item.id !== notification.id));
    try {
      await crmFetch(`/api/crm/notifications/${notification.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "read" }),
      });
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
    } catch {
      // The source link remains useful if marking the receipt fails briefly.
    }
    window.location.assign(notification.href || "/crm/notifications");
  }, []);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const feed = await crmFetch<NotificationFeed>(
        "/api/crm/notifications?unread=1&limit=20"
      );
      onUnreadCount(feed.unreadCount || 0);

      const storageKey = `${LAST_POPUP_KEY}:${feed.currentUser}`;
      let previous = popupCursor.current.get(storageKey) || null;
      try {
        previous = window.localStorage.getItem(storageKey) || previous;
      } catch {
        // Some privacy modes block local storage. The in-memory cursor still
        // prevents duplicate alerts for the lifetime of this page.
      }
      if (!previous) {
        // Establish a baseline without replaying old alerts on first use.
        popupCursor.current.set(storageKey, feed.serverTime);
        try {
          window.localStorage.setItem(storageKey, feed.serverTime);
        } catch {
          // The in-memory cursor above is the safe fallback.
        }
        return;
      }

      const previousTime = new Date(previous).getTime();
      const fresh = feed.notifications
        .filter((item) => new Date(item.createdAt).getTime() > previousTime)
        .sort(
          (left, right) =>
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
        );
      if (!fresh.length) return;

      const latestTime = fresh.reduce(
        (latest, item) =>
          Math.max(latest, new Date(item.createdAt).getTime()),
        previousTime
      );
      const nextCursor = new Date(latestTime).toISOString();
      popupCursor.current.set(storageKey, nextCursor);
      try {
        window.localStorage.setItem(storageKey, nextCursor);
      } catch {
        // The in-memory cursor above is the safe fallback.
      }
      setToasts((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...fresh.filter((item) => !seen.has(item.id))].slice(-3);
      });

      if ("Notification" in window && Notification.permission === "granted") {
        for (const item of fresh) {
          const popup = new Notification(item.title, {
            body: item.body,
            tag: item.id,
            icon: "/favicon.ico",
          });
          popup.onclick = () => {
            window.focus();
            void openNotification(item);
            popup.close();
          };
        }
      }
    } catch {
      // Notifications never block the CRM if the network is briefly unavailable.
    } finally {
      loading.current = false;
    }
  }, [onUnreadCount, openNotification]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const refresh = () => void load();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("lc:notifications-updated", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("lc:notifications-updated", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 9_000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  if (!toasts.length) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 right-3 z-[100] flex w-[min(23rem,calc(100vw-1.5rem))] flex-col gap-2 sm:bottom-5 sm:right-5"
    >
      {toasts.map((notification) => (
        <div
          key={notification.id}
          className="rounded-xl border border-amber/55 bg-panel p-3 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber shadow-[0_0_12px_currentColor]" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[0.52rem] uppercase tracking-wider text-amber">
                New CRM notification
              </p>
              <p className="mt-1 text-sm font-medium text-bone">{notification.title}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted">
                {notification.body}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close notification"
              onClick={() =>
                setToasts((current) =>
                  current.filter((item) => item.id !== notification.id)
                )
              }
              className="min-h-8 min-w-8 rounded-full text-muted hover:text-bone"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            onClick={() => void openNotification(notification)}
            className="mt-3 min-h-10 w-full rounded-lg border border-amber/50 bg-amber/10 px-3 font-mono text-[0.58rem] uppercase tracking-wider text-amber"
          >
            Open
          </button>
        </div>
      ))}
    </div>
  );
}
