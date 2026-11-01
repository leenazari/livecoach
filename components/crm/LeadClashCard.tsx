"use client";

import { useState } from "react";
import {
  clashSummary,
  type LeadClashMatch,
} from "@/lib/lead-clash-rules";

export default function LeadClashCard({
  matches,
  busy = false,
  confirmLabel = "Save anyway",
  onCancel,
  onProceed,
}: {
  matches: LeadClashMatch[];
  busy?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  onProceed: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const soft = matches.every((match) => match.matchType === "name");
  const ready = reason.trim().length >= 8 && !busy;

  return (
    <section
      role="alert"
      aria-label="Lead clash warning"
      className="rounded-xl border border-amber/55 bg-amber/[0.08] p-3"
    >
      <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-amber">
        {soft ? "Possible lead clash" : "Lead clash"}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {matches.map((match) => (
          <li
            key={`${match.otherUserId}:${match.otherCompanyId || match.matchType}`}
            className="rounded-lg border border-edge bg-ink/50 p-2.5"
          >
            <p className="font-sans text-sm leading-snug text-bone">
              {clashSummary(match)}
            </p>
            <p className="mt-1 font-mono text-[0.55rem] uppercase tracking-wider text-muted">
              {match.matchType === "name"
                ? "Possible name match"
                : match.matchType === "person"
                  ? "Same person"
                  : "Same website or email domain"}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 font-sans text-xs leading-relaxed text-bone/70">
        Nothing has been saved. Continue only if this is a different lead, and say why. A workspace owner and the other rep get a short notice. Notes, deal values and email content stay private.
      </p>
      <label className="mt-2 block">
        <span className="mb-1 block font-mono text-[0.55rem] uppercase tracking-wider text-muted">
          Reason for continuing
        </span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="For example: different department, already agreed with the owner"
          className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none placeholder:text-muted/50 focus:border-amber/60"
        />
      </label>
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-edge px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-muted hover:text-bone"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onProceed(reason.trim())}
          className="rounded-lg bg-amber px-3 py-2 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Saving…" : confirmLabel}
        </button>
      </div>
    </section>
  );
}
