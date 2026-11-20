import { crmFetch } from "@/lib/crm";

export type CalendarSyncResult = {
  provider?: string;
  added?: number;
  updated?: number;
  removed?: number;
  relinked?: number;
  reopened?: number;
  reconciled?: boolean;
  calendarReconnectRequired?: boolean;
  warning?: string | null;
  queued?: boolean;
  backgroundCompleted?: boolean;
  finishedAt?: string;
};

type CalendarSyncStatus = {
  state: "pending" | "complete" | "failed" | "unknown";
  finishedAt?: string;
  message?: string;
};

// Poll only during an explicit sync (or first connection), never continuously.
// A 202 is an acknowledgement, not proof that the calendar has finished. Only
// send one POST; status reads must not enqueue more provider/API work.
export async function syncCalendarAndWait(): Promise<CalendarSyncResult> {
  const result = await crmFetch<CalendarSyncResult>("/api/crm/calendar-sync", { method: "POST" });
  if (!result.queued) return result;

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await crmFetch<CalendarSyncStatus>("/api/crm/calendar-sync/status");
    if (status.state === "complete") {
      return { queued: false, backgroundCompleted: true, finishedAt: status.finishedAt };
    }
    if (status.state === "failed") throw new Error(status.message || "Calendar sync did not finish. Open Calls to check the latest saved meetings.");
    if (status.state === "unknown") throw new Error("Calendar sync could not be confirmed. Open Calls to check the latest saved meetings. Do not recreate your calendar event.");
  }
  return {
    ...result,
    queued: true,
    warning: "Your calendar update is still running in the background. You can keep using LiveCoach. Open Calls shortly to check the latest meetings. Do not recreate your calendar event.",
  };
}
