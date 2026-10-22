// Browser identity is a launch-only preference. Never persist this hint on a
// calendar event or pass it to the notetaker / shared-capture matching logic.
export const GOOGLE_MEET_ACCOUNT_KEY = "google_meet_account_email";

export function normaliseMeetingAccountEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return "";
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    ? email
    : null;
}

export function isGoogleMeetLaunchUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "meet.google.com" &&
      !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export function withGoogleMeetingAccount(meetingUrl: string, email: unknown): string {
  const account = normaliseMeetingAccountEmail(email);
  if (!account || !isGoogleMeetLaunchUrl(meetingUrl)) return meetingUrl;
  const url = new URL(meetingUrl);
  // Email is stable across Google sign-in order. Replace, don't append a
  // second authuser, because imported invites can already contain a number.
  url.searchParams.set("authuser", account);
  return url.toString();
}

// Open synchronously from the click, then resolve the current user's private
// preference on the server. This avoids both popup blocking and a stale
// browser cache choosing a previous user's account on a shared computer.
export function browserMeetingLaunchUrl(meetingUrl: string): string {
  if (!isGoogleMeetLaunchUrl(meetingUrl)) return meetingUrl;
  return `/api/meet/open?url=${encodeURIComponent(meetingUrl)}`;
}
