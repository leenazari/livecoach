"use client";

import { useEffect, useState } from "react";

import {
  CRM_BLOCKER_EVENT,
  type CrmBlockerEventDetail,
} from "@/lib/crm";

const RESPONSIBLE_LABEL: Record<
  CrmBlockerEventDetail["blocker"]["responsible"],
  string
> = {
  user: "You can resolve this",
  manager: "A manager needs to resolve this",
  owner: "A workspace owner needs to resolve this",
  system: "LiveCoach needs to complete this safely",
};

export default function CrmBlockerAlert() {
  const [detail, setDetail] = useState<CrmBlockerEventDetail | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const next = (event as CustomEvent<CrmBlockerEventDetail>).detail;
      if (!next?.blocker) return;
      setDetail(next);
    };
    window.addEventListener(CRM_BLOCKER_EVENT, show);
    return () => window.removeEventListener(CRM_BLOCKER_EVENT, show);
  }, []);

  if (!detail) return null;

  return (
    <aside
      role="alert"
      aria-live="assertive"
      aria-label="CRM action blocker"
      className="fixed left-1/2 top-3 z-[100] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-rust/55 bg-panel/98 p-4 text-bone shadow-2xl backdrop-blur sm:top-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-rust">
            Action not completed
          </p>
          <h2 className="mt-1 font-display text-lg text-bone">
            {detail.blocker.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setDetail(null)}
          aria-label="Dismiss blocker explanation"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge text-muted transition hover:border-rust/60 hover:text-rust"
        >
          ×
        </button>
      </div>

      <div className="mt-3 grid gap-3 text-sm leading-relaxed sm:grid-cols-2">
        <div className="rounded-xl border border-edge bg-ink/45 p-3">
          <p className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
            Why it stopped
          </p>
          <p className="mt-1 text-bone/85">{detail.blocker.reason}</p>
        </div>
        <div className="rounded-xl border border-amber/35 bg-amber/[0.06] p-3">
          <p className="font-mono text-[0.54rem] uppercase tracking-wider text-amber">
            What to do next
          </p>
          <p className="mt-1 text-bone/90">{detail.blocker.nextAction}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.66rem]">
        <span className="text-muted">
          {RESPONSIBLE_LABEL[detail.blocker.responsible]}
        </span>
        <span className="font-mono uppercase tracking-wider text-muted/80">
          Blocker code {detail.blocker.code}
        </span>
      </div>
    </aside>
  );
}
