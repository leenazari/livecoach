"use client";

import { useState } from "react";

export default function ReturnToInboxButton() {
  const [manualCloseVisible, setManualCloseVisible] = useState(false);

  const returnToInbox = () => {
    setManualCloseVisible(false);

    if (window.opener && !window.opener.closed) {
      window.opener.focus();
      window.close();
    } else {
      window.close();
    }

    window.setTimeout(() => {
      if (window.closed) return;
      if (document.referrer && window.history.length > 1) {
        window.history.back();
        return;
      }
      setManualCloseVisible(true);
    }, 150);
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={returnToInbox}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-amber px-6 font-mono text-xs font-semibold uppercase tracking-wider text-ink"
      >
        Close and return to email
      </button>
      <p className="mt-3 text-xs leading-5 text-muted">
        Returns to the email screen you were using. This page never opens or
        chooses a different mailbox.
      </p>
      {manualCloseVisible ? (
        <div
          className="mt-4 rounded-xl border border-edge bg-ink/35 p-4"
          role="status"
        >
          <p className="text-sm leading-6 text-bone/85">
            Your browser has blocked this page from closing itself. Close this
            tab to return to the email you were reading.
          </p>
        </div>
      ) : null}
    </div>
  );
}
