"use client";

import { useMemo, useRef, useState } from "react";

import { crmFetch } from "@/lib/crm";
import {
  followUpAtFromLocalParts,
  followUpAtIsPast,
  localDateInputValue,
} from "@/lib/follow-up-scheduling";

const input =
  "w-full rounded-lg border border-edge bg-ink/55 px-3 py-2.5 text-sm text-bone outline-none placeholder:text-muted/55 focus:border-amber/60";

export default function ProspectFollowUpReminder({
  prospect,
  onSaved,
  onCancel,
}: {
  prospect: Record<string, any>;
  onSaved: (result: { created: boolean; rescheduled: boolean }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const name = [prospect.first_name, prospect.last_name]
    .filter(Boolean)
    .join(" ");
  const subject = name || prospect.company_name || "this prospect";
  const [text, setText] = useState(`Follow up with ${subject}`);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef("");
  const minimumDate = useMemo(() => localDateInputValue(), []);

  const save = async () => {
    if (saving) return;
    const followUpAt = followUpAtFromLocalParts(followUpDate, followUpTime);
    if (!followUpAt) {
      setError("Choose a valid follow-up date and time.");
      return;
    }
    if (followUpAtIsPast(followUpAt)) {
      setError("Choose a follow-up time that has not already passed.");
      return;
    }
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    setSaving(true);
    setError("");
    try {
      const result = await crmFetch<{
        ok: boolean;
        created: boolean;
        rescheduled: boolean;
      }>(`/api/crm/outreach/${prospect.id}/follow-up`, {
        method: "POST",
        body: JSON.stringify({
          requestId: requestIdRef.current,
          text: text.trim(),
          followUpAt,
        }),
      });
      if (!result.ok) throw new Error("LiveCoach did not confirm the reminder");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
      await onSaved(result);
    } catch (caught: any) {
      setError(
        caught?.message || "That follow-up reminder did not save. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const ready =
    text.trim().length >= 3 && Boolean(followUpDate) && Boolean(followUpTime);

  return (
    <section className="rounded-xl border border-amber/45 bg-amber/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.55rem] uppercase tracking-wider text-amber">
            Log follow-up reminder
          </p>
          <h4 className="mt-1 font-display text-lg text-bone">{subject}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">
            This creates one reminder in Today, To-dos and Calls. If this person already has an open manual reminder, its date and time are updated instead of creating a duplicate.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-10 px-2 font-mono text-[0.55rem] uppercase text-muted"
        >
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(9rem,.7fr)_minmax(8rem,.6fr)]">
        <label>
          <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">
            What needs to happen
          </span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={500}
            className={input}
          />
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">
            Follow-up date
          </span>
          <input
            type="date"
            min={minimumDate}
            value={followUpDate}
            onChange={(event) => setFollowUpDate(event.target.value)}
            className={input}
          />
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">
            Follow-up time
          </span>
          <input
            type="time"
            value={followUpTime}
            onChange={(event) => setFollowUpTime(event.target.value)}
            className={input}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rust">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="min-h-11 rounded-lg border border-edge px-4 font-mono text-[0.58rem] uppercase text-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !ready}
          className="min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 font-mono text-[0.58rem] uppercase text-amber disabled:opacity-40"
        >
          {saving ? "Saving reminder…" : "Save follow-up reminder"}
        </button>
      </div>
    </section>
  );
}
