import { browserMeetingLaunchUrl } from "@/lib/meeting-account";
import { validMeetingUrl } from "@/lib/meeting-url";

// A plain link remains usable after an automatic notetaker resumes the call,
// or when the browser blocks the tab opened by Start. It deliberately has no
// launch marker or bot/session side effects. Google identity is resolved for
// the signed-in user on the server, never copied from the workspace owner.
export default function MeetingLaunchLink({
  meetingUrl,
  className = "",
}: {
  meetingUrl: string;
  className?: string;
}) {
  const url = meetingUrl.trim();
  if (!validMeetingUrl(url)) return null;
  const host = new URL(url).hostname.toLowerCase();
  const provider = /(^|\.)teams\.(microsoft|live)\.com$/.test(host)
    ? "Teams"
    : host === "meet.google.com"
    ? "Meet"
    : /(^|\.)zoom\.(us|com)$/.test(host)
    ? "Zoom"
    : "meeting";

  return (
    <a
      data-meeting-launch
      href={browserMeetingLaunchUrl(url)}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this meeting in a new browser tab. Your current notetaker and live coaching stay running."
      className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-sage/60 bg-sage/15 px-4 py-2.5 font-mono text-[0.62rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 ${className}`}
    >
      Open {provider} <span aria-hidden="true">↗</span>
    </a>
  );
}
