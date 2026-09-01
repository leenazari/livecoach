"use client";

import { useState } from "react";

export default function ReturnToInboxButton({
  senderFirstName,
  senderEmail,
  subject,
}: {
  senderFirstName: string;
  senderEmail: string;
  subject: string;
}) {
  const [replyFallbackVisible, setReplyFallbackVisible] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const safeEmail = senderEmail.replace(/[\r\n]/g, "").trim();
  const cleanSubject = subject.replace(/[\r\n]/g, " ").trim();
  const replySubject = /^re\s*:/i.test(cleanSubject)
    ? cleanSubject
    : `Re: ${cleanSubject || "your message"}`;
  const mailtoHref = `mailto:${safeEmail}?subject=${encodeURIComponent(
    replySubject
  )}`;

  const returnToInbox = () => {
    setReplyFallbackVisible(false);
    setCopyState("idle");

    if (window.opener && !window.opener.closed) {
      window.opener.focus();
      window.close();

      window.setTimeout(() => {
        if (!window.closed) {
          setReplyFallbackVisible(true);
          window.location.assign(mailtoHref);
        }
      }, 150);
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    setReplyFallbackVisible(true);
    window.location.assign(mailtoHref);
  };

  const copySenderEmail = async () => {
    try {
      await navigator.clipboard.writeText(safeEmail);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={returnToInbox}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-amber px-6 font-mono text-xs font-semibold uppercase tracking-wider text-ink"
      >
        Reply to {senderFirstName}
      </button>
      <p className="mt-3 text-xs leading-5 text-muted">
        Returns to the original email when your browser allows it. Otherwise,
        it opens a reply addressed to {senderFirstName}.
      </p>
      {replyFallbackVisible ? (
        <div
          className="mt-4 rounded-xl border border-edge bg-ink/35 p-4"
          role="status"
        >
          <p className="text-sm leading-6 text-bone/85">
            Your email app should open a reply addressed to {senderFirstName}.
            If nothing happened, use either option below.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a
              href={mailtoHref}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-amber/60 px-4 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-amber"
            >
              Open email reply
            </a>
            <button
              type="button"
              onClick={copySenderEmail}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-edge px-4 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-bone"
            >
              Copy {senderFirstName}&apos;s email
            </button>
          </div>
          <p className="mt-3 select-all font-mono text-xs text-muted">
            {safeEmail}
          </p>
          {copyState === "copied" ? (
            <p className="mt-2 text-xs text-sage">
              Email address copied.
            </p>
          ) : null}
          {copyState === "failed" ? (
            <p className="mt-2 text-xs text-muted">
              Copy the address shown above and reply from the email you
              received.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
