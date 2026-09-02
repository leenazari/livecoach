"use client";

import { useEffect, useState } from "react";

import { hasOutreachSalesCallToAction } from "@/lib/outreach-demo-reply-cta";

const CTA_ADVICE_EVENT = "livecoach:outreach-cta-advice-changed";
const CTA_ADVICE_KEY = "livecoach:outreach-cta-advice-dismissed:v1";

export function outreachCtaAdviceStorageKey(input: {
  workspaceId?: string | null;
  userId?: string | null;
}): string {
  const workspaceId = String(input.workspaceId || "").trim();
  const userId = String(input.userId || "").trim();
  return workspaceId && userId
    ? `${CTA_ADVICE_KEY}:${workspaceId}:${userId}`
    : "";
}

export default function OutreachCtaAdvice({
  emailBody,
  voiceScript,
  workspaceId,
  userId,
}: {
  emailBody: string;
  voiceScript?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
}) {
  const storageKey = outreachCtaAdviceStorageKey({ workspaceId, userId });
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setDismissed(
        Boolean(storageKey) && window.localStorage.getItem(storageKey) === "1"
      );
      setReady(true);
    };
    refresh();
    window.addEventListener(CTA_ADVICE_EVENT, refresh);
    return () => window.removeEventListener(CTA_ADVICE_EVENT, refresh);
  }, [storageKey]);

  const emailHasCta = hasOutreachSalesCallToAction(emailBody);
  const hasVoiceScript = Boolean(String(voiceScript || "").trim());
  const voiceHasCta = !hasVoiceScript || hasOutreachSalesCallToAction(voiceScript);
  if (!ready || dismissed || (emailHasCta && voiceHasCta)) return null;

  const missingFrom = !emailHasCta && !voiceHasCta
    ? "email and voice note"
    : !emailHasCta
      ? "email"
      : "voice note";

  const dismiss = () => {
    if (!storageKey) return;
    window.localStorage.setItem(storageKey, "1");
    setDismissed(true);
    window.dispatchEvent(new Event(CTA_ADVICE_EVENT));
  };

  return (
    <aside className="rounded-lg border border-amber/35 bg-amber/[0.06] px-3 py-2" role="note">
      <p className="font-mono text-[0.5rem] uppercase tracking-wider text-amber">
        Optional improvement
      </p>
      <p className="mt-1 text-xs leading-5 text-bone/80">
        The {missingFrom} has no invitation to reply for a quick call or demo. We normally recommend one, but this exact outreach can still be queued without it.
      </p>
      {storageKey ? (
        <button
          type="button"
          onClick={dismiss}
          className="mt-2 min-h-9 rounded-md border border-edge px-2.5 py-1.5 font-mono text-[0.48rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          Do not show CTA tips again
        </button>
      ) : null}
    </aside>
  );
}
