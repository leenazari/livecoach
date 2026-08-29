export type CrmNotificationKind =
  | "outreach_reply"
  | "lead_assigned"
  | "chat_message";

export type NotificationPreferences = {
  replyAlerts: boolean;
  assignmentAlerts: boolean;
  chatAlerts: boolean;
  chatEmailEnabled: boolean;
  inAppEnabled: boolean;
  desktopEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  timezone: string;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  replyAlerts: true,
  assignmentAlerts: true,
  chatAlerts: true,
  chatEmailEnabled: true,
  inAppEnabled: true,
  desktopEnabled: true,
  quietHoursEnabled: false,
  quietStart: "18:00",
  quietEnd: "08:00",
  timezone: "Europe/London",
};

export const mapNotificationPreferences = (
  row?: Record<string, any> | null
): NotificationPreferences => ({
  replyAlerts: row?.reply_alerts ?? DEFAULT_NOTIFICATION_PREFERENCES.replyAlerts,
  assignmentAlerts:
    row?.assignment_alerts ?? DEFAULT_NOTIFICATION_PREFERENCES.assignmentAlerts,
  chatAlerts:
    row?.chat_alerts ?? DEFAULT_NOTIFICATION_PREFERENCES.chatAlerts,
  chatEmailEnabled:
    row?.chat_email_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.chatEmailEnabled,
  inAppEnabled:
    row?.in_app_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.inAppEnabled,
  desktopEnabled:
    row?.desktop_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.desktopEnabled,
  quietHoursEnabled:
    row?.quiet_hours_enabled ??
    DEFAULT_NOTIFICATION_PREFERENCES.quietHoursEnabled,
  quietStart: String(
    row?.quiet_start ?? DEFAULT_NOTIFICATION_PREFERENCES.quietStart
  ).slice(0, 5),
  quietEnd: String(
    row?.quiet_end ?? DEFAULT_NOTIFICATION_PREFERENCES.quietEnd
  ).slice(0, 5),
  timezone: String(
    row?.timezone ?? DEFAULT_NOTIFICATION_PREFERENCES.timezone
  ),
});

export const notificationKindEnabled = (
  preferences: NotificationPreferences,
  kind: CrmNotificationKind
) => {
  if (kind === "outreach_reply") return preferences.replyAlerts;
  if (kind === "chat_message") return preferences.chatAlerts;
  return preferences.assignmentAlerts;
};

const clockMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

export const isQuietHoursActive = (
  preferences: NotificationPreferences,
  now = new Date()
) => {
  if (!preferences.quietHoursEnabled) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: preferences.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    const current = hour * 60 + minute;
    const start = clockMinutes(preferences.quietStart);
    const end = clockMinutes(preferences.quietEnd);
    return start < end
      ? current >= start && current < end
      : current >= start || current < end;
  } catch {
    // Invalid timezones are rejected by the API. Failing open here avoids
    // silently suppressing alerts if a legacy value is malformed.
    return false;
  }
};

export const isValidClockTime = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export const isValidTimezone = (value: unknown): value is string => {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const MAX_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export const parseNotificationSnoozeUntil = (value: unknown) => {
  if (typeof value !== "string") return null;
  const timestamp = new Date(value).getTime();
  const now = Date.now();
  if (
    !Number.isFinite(timestamp) ||
    timestamp <= now ||
    timestamp > now + MAX_SNOOZE_MS
  )
    return null;
  return new Date(timestamp).toISOString();
};
