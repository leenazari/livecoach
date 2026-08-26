// Shared by the browser launch controls and the server-side transcriber gate.
// Keeping one allow-list means LiveCoach never opens a calendar description or
// manually entered URL that is not a recognised meeting provider.
const MEETING_HOSTS = [
  "meet.google.com",
  "teams.microsoft.com",
  "teams.live.com",
  "zoom.us",
  "zoom.com",
  "webex.com",
  "whereby.com",
  "meet.jit.si",
  "chime.aws",
  "around.co",
  "around.com",
  "gotomeeting.com",
  "gotomeet.me",
];

export function validMeetingUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return MEETING_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}
