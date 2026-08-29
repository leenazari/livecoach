"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import MatrixRain from "@/components/MatrixRain";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import {
  type CrmNotificationKind,
  type NotificationPreferences,
  isQuietHoursActive,
} from "@/lib/crm-notifications";

type CrmNotification = {
  id: string;
  kind: CrmNotificationKind;
  title: string;
  body: string;
  href: string | null;
  sourceTable: string;
  sourceId: string;
  readAt: string | null;
  snoozedUntil: string | null;
  attentionAt: string;
  createdAt: string;
};

type NotificationFeed = {
  notifications: CrmNotification[];
  unreadCount: number;
  chatUnreadCount: number;
  snoozedCount: number;
  preferences: NotificationPreferences;
  currentUser: string;
  serverTime: string;
};

type Filter =
  | "unread"
  | "all"
  | "chats"
  | "replies"
  | "assignments"
  | "snoozed";
type BrowserPermission = NotificationPermission | "unsupported";
type ItemAction = "read" | "unread" | "dismiss" | "snooze";
type SnoozePreset = "hour" | "day" | "week";

const button =
  "min-h-11 rounded-lg border border-edge px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-wait disabled:opacity-45";
const primary =
  "min-h-11 rounded-lg border border-amber/55 bg-amber/10 px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-wait disabled:opacity-45";
const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC",
];

const formatWhen = (value: string, timezone: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const snoozeUntil = (preset: SnoozePreset) => {
  const durations = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() + durations[preset]).toISOString();
};

const isFutureSnooze = (notification: CrmNotification) =>
  !!notification.snoozedUntil &&
  new Date(notification.snoozedUntil).getTime() > Date.now();

const notificationPermissionHelp = (userAgent: string) => {
  if (/iphone|ipad/i.test(userAgent)) {
    return "Add LiveCoach to your Home Screen, open it from the new icon, then allow notifications when asked.";
  }
  if (/android/i.test(userAgent)) {
    return "Open the browser menu, choose Settings, Site settings, Notifications, then allow livecoachcrm.com.";
  }
  if (/firefox/i.test(userAgent)) {
    return "Click the padlock beside the address, open the site permissions, set Send notifications to Allow, then return here.";
  }
  if (/safari/i.test(userAgent) && !/(?:chrome|chromium|crios|edg)/i.test(userAgent)) {
    return "Open Safari Settings, choose Websites, then Notifications, and set livecoachcrm.com to Allow.";
  }
  return "Click the site controls icon beside the web address, open Site settings, set Notifications to Allow, then return here.";
};

export default function NotificationsPage() {
  const router = useRouter();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [filter, setFilter] = useState<Filter>("unread");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [error, setError] = useState("");
  const [permission, setPermission] =
    useState<BrowserPermission>("unsupported");
  const [permissionHelp, setPermissionHelp] = useState(
    "Open this site's browser settings and allow notifications."
  );

  const syncDesktopPermission = useCallback(() => {
    if (typeof window === "undefined") return;
    setPermission(
      "Notification" in window ? Notification.permission : "unsupported"
    );
    setPermissionHelp(notificationPermissionHelp(window.navigator.userAgent));
  }, []);

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
    syncDesktopPermission();
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const refresh = () => {
      syncDesktopPermission();
      void load();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("lc:notifications-updated", refresh);
    window.addEventListener("lc:notifications-realtime", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("lc:notifications-updated", refresh);
      window.removeEventListener("lc:notifications-realtime", refresh);
    };
  }, [load, syncDesktopPermission]);

  const counts = useMemo(() => {
    const notifications = feed?.notifications || [];
    return {
      all: notifications.length,
      replies: notifications.filter((item) => item.kind === "outreach_reply")
        .length,
      assignments: notifications.filter(
        (item) => item.kind === "lead_assigned"
      ).length,
      chats: notifications.filter((item) => item.kind === "chat_message").length,
    };
  }, [feed?.notifications]);

  const visible = useMemo(() => {
    const notifications = feed?.notifications || [];
    return notifications.filter((item) => {
      const snoozed = isFutureSnooze(item);
      const matchesFilter =
        filter === "all" ||
        (filter === "unread" && !item.readAt && !snoozed) ||
        (filter === "chats" && item.kind === "chat_message") ||
        (filter === "replies" && item.kind === "outreach_reply") ||
        (filter === "assignments" && item.kind === "lead_assigned") ||
        (filter === "snoozed" && snoozed);
      if (!matchesFilter) return false;
      if (!deferredSearch) return true;
      return `${item.title} ${item.body}`.toLowerCase().includes(deferredSearch);
    });
  }, [deferredSearch, feed?.notifications, filter]);

  const enableDesktop = async () => {
    if (!("Notification" in window)) return;
    setError("");
    try {
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next === "granted") {
        const popup = new Notification("LiveCoach notifications are on", {
          body: "New team messages, replies and assigned leads can now appear on this desktop.",
          tag: "livecoach-notifications-enabled",
          icon: "/brand/livecoach-mark-192.png",
        });
        window.setTimeout(() => popup.close(), 5_000);
      }
    } catch {
      setError(
        "This browser could not enable desktop popups. In-app notifications will still work."
      );
    }
  };

  const checkDesktopPermission = () => {
    if (!("Notification" in window)) return;
    const next = Notification.permission;
    setPermission(next);
    setError(
      next === "denied"
        ? "Notifications are still blocked in this browser. Follow the site settings steps, reload LiveCoach, then check again."
        : ""
    );
    if (next === "default") void enableDesktop();
  };

  const updateOne = async (
    notification: CrmNotification,
    action: ItemAction,
    preset?: SnoozePreset
  ) => {
    setBusy(notification.id);
    setError("");
    try {
      await crmFetch(`/api/crm/notifications/${notification.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          snoozedUntil: preset ? snoozeUntil(preset) : undefined,
        }),
      });
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
      await load();
    } catch (reason: any) {
      setError(reason?.message || "The notification could not be updated.");
    } finally {
      setBusy("");
    }
  };

  const updateMany = async (action: ItemAction, preset?: SnoozePreset) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy("selected");
    setError("");
    try {
      await crmFetch("/api/crm/notifications", {
        method: "PATCH",
        body: JSON.stringify({
          action,
          ids,
          snoozedUntil: preset ? snoozeUntil(preset) : undefined,
        }),
      });
      setSelected(new Set());
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
      await load();
    } catch (reason: any) {
      setError(reason?.message || "The selected notifications could not be updated.");
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
      setSelected(new Set());
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
      await load();
    } catch (reason: any) {
      setError(reason?.message || "Notifications could not be marked as read.");
    } finally {
      setBusy("");
    }
  };

  const savePreferences = async (next: NotificationPreferences) => {
    if (!feed || settingsBusy) return;
    const previous = feed.preferences;
    setFeed({ ...feed, preferences: next });
    setSettingsBusy(true);
    setSettingsSaved(false);
    setError("");
    try {
      const saved = await crmFetch<{
        preferences: NotificationPreferences;
      }>("/api/crm/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      setFeed((current) =>
        current ? { ...current, preferences: saved.preferences } : current
      );
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 2_000);
    } catch (reason: any) {
      setFeed((current) =>
        current ? { ...current, preferences: previous } : current
      );
      setError(reason?.message || "Notification settings could not be saved.");
    } finally {
      setSettingsBusy(false);
    }
  };

  const openSource = async (notification: CrmNotification) => {
    if (!notification.readAt || isFutureSnooze(notification)) {
      try {
        await crmFetch(`/api/crm/notifications/${notification.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "read" }),
        });
        window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
      } catch {
        // The canonical source remains useful if receipt state briefly fails.
      }
    }
    router.push(notification.href || "/crm/notifications");
  };

  const toggleSelection = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((current) =>
      visible.every((item) => current.has(item.id))
        ? new Set()
        : new Set(visible.map((item) => item.id))
    );
  };

  const preferences = feed?.preferences;
  const quietNow = preferences ? isQuietHoursActive(preferences) : false;
  const permissionStyle =
    permission === "granted"
      ? "border-moss/40 bg-moss/[0.08] text-moss"
      : permission === "denied"
        ? "border-rust/45 bg-rust/[0.08] text-rust"
        : "border-sky/40 bg-sky/[0.08] text-sky";
  const filters: Array<{ key: Filter; label: string; count: number }> = [
    { key: "unread", label: "Unread", count: feed?.unreadCount || 0 },
    { key: "all", label: "All", count: counts.all },
    { key: "chats", label: "Chat", count: counts.chats },
    { key: "replies", label: "Replies", count: counts.replies },
    { key: "assignments", label: "Assigned", count: counts.assignments },
    { key: "snoozed", label: "Snoozed", count: feed?.snoozedCount || 0 },
  ];

  return (
    <main className="relative z-10 mx-auto max-w-[1120px] px-3 py-5 pb-24 sm:px-5 sm:py-9 sm:pb-12">
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
            Team messages, replies and assignments, organised around what needs your attention.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            className={`${button} w-full sm:w-auto`}
          >
            Alert settings
          </button>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={!feed?.unreadCount || !!busy}
            className={`${button} w-full sm:w-auto`}
          >
            {busy === "all" ? "Saving…" : "Mark all read"}
          </button>
        </div>
      </header>

      {settingsOpen && preferences ? (
        <section className="mb-4 rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[0.58rem] uppercase tracking-wider text-amber">
                Alert controls
              </p>
              <p className="mt-1 text-sm leading-6 text-muted">
                Changes save immediately. Muted alerts remain safely available in your history.
              </p>
            </div>
            <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
              {settingsBusy
                ? "Saving…"
                : settingsSaved
                  ? "Saved"
                  : quietNow
                    ? "Quiet now"
                    : "Live now"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              ["replyAlerts", "New replies", "Alert when a prospect replies"],
              ["assignmentAlerts", "Lead assignments", "Alert when work is assigned to you"],
              ["chatAlerts", "Team messages", "Show popups when a teammate messages you"],
              ["chatEmailEnabled", "Chat email alerts", "Email a secure link without copying the message body"],
              ["inAppEnabled", "In-app popups", "Show a small LiveCoach alert"],
              ["desktopEnabled", "Desktop popups", "Use browser notifications when allowed"],
            ].map(([key, label, help]) => {
              const preferenceKey = key as keyof NotificationPreferences;
              return (
                <label
                  key={key}
                  className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-lg border border-edge bg-ink/30 p-3"
                >
                  <span>
                    <span className="block text-sm text-bone">{label}</span>
                    <span className="mt-1 block text-xs text-muted">{help}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(preferences[preferenceKey])}
                    disabled={settingsBusy}
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        [preferenceKey]: event.target.checked,
                      })
                    }
                    className="h-5 w-5 accent-amber"
                  />
                </label>
              );
            })}
          </div>

          <div className="mt-3 rounded-lg border border-edge bg-ink/30 p-3">
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-sm text-bone">Quiet hours</span>
                <span className="mt-1 block text-xs text-muted">
                  Pause popups without losing notification history or badges
                </span>
              </span>
              <input
                type="checkbox"
                checked={preferences.quietHoursEnabled}
                disabled={settingsBusy}
                onChange={(event) =>
                  void savePreferences({
                    ...preferences,
                    quietHoursEnabled: event.target.checked,
                  })
                }
                className="h-5 w-5 accent-amber"
              />
            </label>
            {preferences.quietHoursEnabled ? (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-edge pt-3 sm:grid-cols-3">
                <label className="text-xs text-muted">
                  From
                  <input
                    type="time"
                    value={preferences.quietStart}
                    disabled={settingsBusy}
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        quietStart: event.target.value,
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-sm text-bone"
                  />
                </label>
                <label className="text-xs text-muted">
                  Until
                  <input
                    type="time"
                    value={preferences.quietEnd}
                    disabled={settingsBusy}
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        quietEnd: event.target.value,
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-sm text-bone"
                  />
                </label>
                <label className="col-span-2 text-xs text-muted sm:col-span-1">
                  Timezone
                  <select
                    value={preferences.timezone}
                    disabled={settingsBusy}
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        timezone: event.target.value,
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-sm text-bone"
                  >
                    {TIMEZONES.map((timezone) => (
                      <option key={timezone} value={timezone}>
                        {timezone.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

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
                  ? "Blocked in this browser. Browsers will not show the permission prompt again until you allow LiveCoach in site settings."
                  : permission === "unsupported"
                    ? "This browser does not support desktop notifications."
                    : "Optional. Enable popups for team messages, replies and newly assigned leads."}
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
          ) : permission === "denied" ? (
            <div className="w-full rounded-lg border border-rust/35 bg-rust/[0.06] p-3 sm:max-w-md">
              <p className="text-xs leading-5 text-bone/80">{permissionHelp}</p>
              <button
                type="button"
                onClick={checkDesktopPermission}
                className={`${button} mt-2 w-full border-rust/45 text-rust sm:w-auto`}
              >
                I allowed it, check again
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust"
        >
          {error}
        </p>
      ) : null}

      <section className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setFilter(item.key);
              setSelected(new Set());
            }}
            className={`min-h-11 shrink-0 rounded-full border px-4 font-mono text-[0.58rem] uppercase tracking-wider transition ${
              filter === item.key
                ? "border-amber/60 bg-amber/10 text-amber"
                : "border-edge bg-panel text-muted hover:border-amber/40 hover:text-bone"
            }`}
          >
            {item.label} · {item.count}
          </button>
        ))}
      </section>

      <section className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search notifications</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search a person, company or reply…"
            className="min-h-12 w-full rounded-xl border border-edge bg-panel px-4 text-sm text-bone outline-none transition placeholder:text-muted/70 focus:border-amber/60"
          />
        </label>
        <button
          type="button"
          onClick={selectAllVisible}
          disabled={!visible.length}
          className={`${button} w-full sm:w-auto`}
        >
          {visible.length && visible.every((item) => selected.has(item.id))
            ? "Clear selection"
            : "Select visible"}
        </button>
      </section>

      {selected.size ? (
        <section className="sticky top-2 z-20 mb-4 rounded-xl border border-amber/50 bg-panel p-3 shadow-xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="mr-auto font-mono text-[0.58rem] uppercase tracking-wider text-amber">
              {selected.size} selected
            </span>
            <button
              type="button"
              onClick={() => void updateMany("read")}
              disabled={!!busy}
              className={`${button} w-full sm:w-auto`}
            >
              Mark read
            </button>
            <button
              type="button"
              onClick={() => void updateMany("snooze", "day")}
              disabled={!!busy}
              className={`${button} w-full sm:w-auto`}
            >
              Snooze 1 day
            </button>
            <button
              type="button"
              onClick={() => void updateMany("dismiss")}
              disabled={!!busy}
              className="min-h-11 w-full rounded-lg border border-rust/35 px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-rust disabled:opacity-45 sm:w-auto"
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      {loading && !feed ? (
        <MatrixRain
          size="panel"
          messages={[
            "loading your alerts",
            "checking new replies",
            "checking assigned leads",
          ]}
        />
      ) : visible.length ? (
        <section className="space-y-2">
          {visible.map((notification) => {
            const snoozed = isFutureSnooze(notification);
            const unread = !notification.readAt && !snoozed;
            const checked = selected.has(notification.id);
            return (
              <article
                key={notification.id}
                className={`rounded-xl border p-4 [content-visibility:auto] ${
                  checked
                    ? "border-sky/60 bg-sky/[0.08]"
                    : unread
                      ? "border-amber/50 bg-amber/[0.07]"
                      : "border-edge bg-panel"
                }`}
              >
                <div className="flex items-start gap-3">
                  <label className="flex min-h-10 min-w-8 cursor-pointer items-start justify-center pt-1.5">
                    <span className="sr-only">Select {notification.title}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelection(notification.id)}
                      className="h-5 w-5 accent-amber"
                    />
                  </label>
                  <span
                    className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${
                      snoozed
                        ? "bg-sky"
                        : unread
                          ? "bg-amber shadow-[0_0_12px_currentColor]"
                          : "bg-edge"
                    }`}
                    aria-label={snoozed ? "Snoozed" : unread ? "Unread" : "Read"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                            {notification.kind === "outreach_reply"
                              ? "Outreach reply"
                              : notification.kind === "chat_message"
                                ? "Team message"
                                : "Lead assignment"}
                          </p>
                          {snoozed ? (
                            <span className="rounded-full border border-sky/40 bg-sky/10 px-2 py-0.5 font-mono text-[0.48rem] uppercase text-sky">
                              Snoozed
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => void openSource(notification)}
                          disabled={busy === notification.id}
                          className="mt-1 min-h-10 rounded-md text-left text-base font-medium text-bone transition hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70"
                          aria-label={`Open ${notification.title} in CRM`}
                        >
                          {notification.title}
                        </button>
                      </div>
                      <time className="font-mono text-[0.5rem] uppercase text-muted">
                        {formatWhen(
                          snoozed
                            ? notification.snoozedUntil!
                            : notification.createdAt,
                          preferences?.timezone || "Europe/London"
                        )}
                        {snoozed ? " return" : ""}
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
                          void updateOne(
                            notification,
                            snoozed ? "unread" : unread ? "read" : "unread"
                          )
                        }
                        disabled={busy === notification.id}
                        className={`${button} w-full sm:w-auto`}
                      >
                        {snoozed
                          ? "Unsnooze"
                          : unread
                            ? "Mark read"
                            : "Mark unread"}
                      </button>
                      {!snoozed ? (
                        <select
                          aria-label={`Snooze ${notification.title}`}
                          value=""
                          disabled={busy === notification.id}
                          onChange={(event) => {
                            const preset = event.target.value as SnoozePreset;
                            if (preset)
                              void updateOne(notification, "snooze", preset);
                          }}
                          className="min-h-11 w-full rounded-lg border border-edge bg-panel px-3 font-mono text-[0.58rem] uppercase tracking-wider text-bone sm:w-auto"
                        >
                          <option value="">Snooze…</option>
                          <option value="hour">For 1 hour</option>
                          <option value="day">For 1 day</option>
                          <option value="week">For 1 week</option>
                        </select>
                      ) : null}
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
            {deferredSearch
              ? "No notifications match that search."
              : filter === "unread"
                ? "You are all caught up."
                : filter === "snoozed"
                  ? "Nothing is snoozed."
                  : "No notifications here yet."}
          </p>
          <p className="mt-2 text-sm text-muted">
            Team messages, new replies and newly assigned leads will appear automatically.
          </p>
        </section>
      )}
    </main>
  );
}
