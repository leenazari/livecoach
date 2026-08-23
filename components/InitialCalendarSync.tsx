"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";

type CalendarSyncResult = {
  provider?: "google" | "microsoft";
  added?: number;
  updated?: number;
  removed?: number;
  relinked?: number;
  reconciled?: boolean;
};

type SyncState =
  | { status: "idle"; message: "" }
  | { status: "syncing" | "success" | "error"; message: string };

function successMessage(result: CalendarSyncResult): string {
  const provider =
    result.provider === "microsoft"
      ? "Microsoft calendar"
      : result.provider === "google"
        ? "Google Calendar"
        : "Calendar";
  const changes: string[] = [];
  if (result.added) changes.push(`${result.added} new`);
  if (result.updated) changes.push(`${result.updated} updated`);
  if (result.removed) changes.push(`${result.removed} cancelled removed`);
  if (result.relinked) changes.push(`${result.relinked} relinked`);
  const outcome = changes.length ? changes.join(", ") : "already up to date";
  const partial =
    result.reconciled === false
      ? " Cancellations were kept safely because the provider returned a partial result."
      : "";
  return `${provider} connected and synced. ${outcome}.${partial}`;
}

export default function InitialCalendarSync({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  const attempted = useRef(false);
  const [state, setState] = useState<SyncState>({ status: "idle", message: "" });

  useEffect(() => {
    if (!enabled || attempted.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar") !== "sync") return;

    attempted.current = true;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("calendar");
    window.history.replaceState({}, "", cleanUrl.toString());
    setState({
      status: "syncing",
      message: "Connection saved. Syncing your calendar for the first time…",
    });

    void crmFetch<CalendarSyncResult>("/api/crm/calendar-sync", {
      method: "POST",
    })
      .then((result) => {
        window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
        setState({ status: "success", message: successMessage(result) });
      })
      .catch((error: any) => {
        setState({
          status: "error",
          message: `Your connection is saved, but the first calendar sync did not finish${
            error?.message ? ` because ${error.message}` : ""
          }. Use Sync calendar on the CRM dashboard to try again.`,
        });
      });
  }, [enabled]);

  if (state.status === "idle") return null;

  const style =
    state.status === "success"
      ? "border-sage/40 bg-sage/[0.08] text-sage"
      : state.status === "error"
        ? "border-rust/45 bg-rust/[0.08] text-rust"
        : "border-sky/40 bg-sky/[0.08] text-sky";

  return (
    <p
      aria-live="polite"
      className={`mb-5 rounded-xl border px-4 py-3 text-sm leading-6 ${style}`}
    >
      {state.status === "syncing" ? "↻ " : state.status === "success" ? "✓ " : "! "}
      {state.message}
    </p>
  );
}
