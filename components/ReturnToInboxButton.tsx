"use client";

import { useState } from "react";

export default function ReturnToInboxButton({
  senderFirstName,
}: {
  senderFirstName: string;
}) {
  const [needsManualClose, setNeedsManualClose] = useState(false);

  const returnToInbox = () => {
    setNeedsManualClose(false);

    if (window.opener && !window.opener.closed) {
      window.opener.focus();
      window.close();

      window.setTimeout(() => {
        if (!window.closed) setNeedsManualClose(true);
      }, 150);
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    setNeedsManualClose(true);
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={returnToInbox}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-amber px-6 font-mono text-xs font-semibold uppercase tracking-wider text-ink"
      >
        Reply to {senderFirstName} in your inbox
      </button>
      {needsManualClose ? (
        <p className="mt-3 text-xs leading-5 text-muted" role="status">
          This page was opened without inbox history. Close this tab to return
          to your email. No new mail app has been opened.
        </p>
      ) : null}
    </div>
  );
}
