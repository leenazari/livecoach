import { validMeetingUrl } from "@/lib/meeting-url";

const STORAGE_KEY = "livecoach:pending-call-launch";
const MAX_AGE_MS = 2 * 60 * 1000;

type PendingLaunch = {
  upcomingId: string;
  meetingUrl: string;
  createdAt: number;
};

// Must be called directly from the user's click. That is what allows the
// browser to open Teams, Meet or Zoom without treating it as a popup. The
// short-lived session marker lets the next LiveCoach screen distinguish this
// deliberate action from somebody sharing or refreshing a URL with launch=1.
export function openAndArmCallLaunch(
  upcomingId: string,
  meetingUrl: string
): boolean {
  const cleanId = upcomingId.trim();
  const cleanUrl = meetingUrl.trim();
  if (
    typeof window === "undefined" ||
    !cleanId ||
    !validMeetingUrl(cleanUrl)
  )
    return false;

  let armed = false;
  try {
    const pending: PendingLaunch = {
      upcomingId: cleanId,
      meetingUrl: cleanUrl,
      createdAt: Date.now(),
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    armed = true;
  } catch {
    // Opening the meeting is still useful. Without the one-use marker the call
    // screen stays safe and asks for one explicit Start press for the bot.
  }
  window.open(cleanUrl, "_blank", "noopener,noreferrer");
  return armed;
}

export function consumeArmedCallLaunch(
  upcomingId: string,
  meetingUrl: string
): boolean {
  if (typeof window === "undefined") return false;
  let raw = "";
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY) || "";
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const pending = JSON.parse(raw) as Partial<PendingLaunch>;
    const age = Date.now() - Number(pending.createdAt || 0);
    return (
      age >= 0 &&
      age <= MAX_AGE_MS &&
      pending.upcomingId === upcomingId.trim() &&
      pending.meetingUrl === meetingUrl.trim() &&
      validMeetingUrl(pending.meetingUrl)
    );
  } catch {
    return false;
  }
}
