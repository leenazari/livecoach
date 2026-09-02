"use client";

import { useEffect, useRef, useState } from "react";

import { hasOutreachSalesCallToAction } from "@/lib/outreach-demo-reply-cta";

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
  voiceNoteReady = false,
  campaignHasCta = false,
  campaignOptedOut = false,
  workspaceId,
  userId,
}: {
  emailBody: string;
  voiceScript?: string | null;
  voiceNoteReady?: boolean;
  campaignHasCta?: boolean;
  campaignOptedOut?: boolean;
  workspaceId?: string | null;
  userId?: string | null;
}) {
  const storageKey = outreachCtaAdviceStorageKey({ workspaceId, userId });
  const emailHasCta =
    voiceNoteReady || hasOutreachSalesCallToAction(emailBody);
  const hasVoiceScript = Boolean(String(voiceScript || "").trim());
  const voiceHasCta =
    voiceNoteReady ||
    !hasVoiceScript ||
    hasOutreachSalesCallToAction(voiceScript);
  const needsAdvice =
    !campaignOptedOut && !campaignHasCta && (!emailHasCta || !voiceHasCta);
  const [visible, setVisible] = useState(false);
  const claimedThisMount = useRef(false);

  useEffect(() => {
    if (!needsAdvice || !storageKey) {
      setVisible(false);
      return;
    }
    if (claimedThisMount.current) {
      setVisible(true);
      return;
    }
    try {
      if (window.localStorage.getItem(storageKey) === "1") {
        setVisible(false);
        return;
      }
      // Claim the one permitted coaching note immediately. Other draft rows on
      // this page, and every later visit for this exact user, stay quiet.
      window.localStorage.setItem(storageKey, "1");
      claimedThisMount.current = true;
      setVisible(true);
    } catch {
      // Optional coaching must never interrupt outreach when browser storage is
      // unavailable. It is safer to stay quiet than repeat on every attempt.
      setVisible(false);
    }
  }, [needsAdvice, storageKey]);

  if (!visible) return null;

  const missingFrom = !emailHasCta && !voiceHasCta
    ? "email and voice note"
    : !emailHasCta
      ? "email"
      : "voice note";

  const dismiss = () => {
    setVisible(false);
  };

  return (
    <aside className="rounded-lg border border-amber/35 bg-amber/[0.06] px-3 py-2" role="note">
      <p className="font-mono text-[0.5rem] uppercase tracking-wider text-amber">
        Optional improvement
      </p>
      <p className="mt-1 text-xs leading-5 text-bone/80">
        The {missingFrom} has no invitation to reply for a quick call or demo. We normally recommend one, but this exact outreach can still be queued without it.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="mt-2 min-h-9 rounded-md border border-edge px-2.5 py-1.5 font-mono text-[0.48rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
      >
        Got it
      </button>
    </aside>
  );
}
