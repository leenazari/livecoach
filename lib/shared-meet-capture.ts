import { createHash } from "node:crypto";
import { validMeetingUrl } from "@/lib/meeting-url";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function normaliseMeetingUrl(value: unknown): string | null {
  if (!validMeetingUrl(value)) return null;
  const url = new URL(value.trim());
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function meetingUrlsMatch(left: unknown, right: unknown) {
  const a = normaliseMeetingUrl(left);
  const b = normaliseMeetingUrl(right);
  return !!a && !!b && a === b;
}

export function meetingInstanceKey(
  meetingUrl: unknown,
  scheduledAt: unknown
): string | null {
  const canonicalUrl = normaliseMeetingUrl(meetingUrl);
  if (!canonicalUrl || typeof scheduledAt !== "string") return null;
  const scheduled = new Date(scheduledAt);
  if (!Number.isFinite(scheduled.getTime())) return null;
  scheduled.setUTCSeconds(0, 0);
  return createHash("sha256")
    .update(`${canonicalUrl}|${scheduled.toISOString()}`)
    .digest("hex");
}

export function shareableCalendarSource(source: unknown, externalId: unknown) {
  return (
    (source === "google" || source === "microsoft") &&
    typeof externalId === "string" &&
    externalId.trim().length > 0
  );
}
