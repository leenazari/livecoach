"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { crmConfirmationError, crmFetch, getCached } from "@/lib/crm";
import { openAndArmCallLaunch } from "@/lib/call-launch";
import { validMeetingUrl } from "@/lib/meeting-url";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";
import VoiceNoteButton from "@/components/VoiceNoteButton";
import { CALENDAR_DURATION_OPTIONS } from "@/lib/calendar-create";

type Upcoming = {
  id: string;
  company_id: string | null;
  company: string | null;
  title: string | null;
  scheduled_at: string | null;
  meeting_url: string | null;
  intent: string | null;
  prepped: boolean;
  completed_at?: string | null;
};

type UpcomingFeed = {
  calls: Upcoming[];
  callReminders?: CallReminder[];
  recentlyCompleted?: Upcoming[];
};

type CallReminder = {
  id: string;
  text: string;
  dueAt: string;
  createdAt: string;
};

const fmtWhen = (iso: string | null) => {
  if (!iso) return "no time set";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const fmtReminderDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const newCalendarRequestId = () => {
  const browserCrypto = globalThis.crypto;
  if (!browserCrypto) {
    throw new Error("Secure event creation is not available in this browser");
  }
  if (typeof browserCrypto.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  browserCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

export default function UpcomingCalls({
  limit = 10,
  daysAhead,
}: {
  limit?: number;
  daysAhead?: number;
}) {
  const router = useRouter();
  const feedUrl = daysAhead
    ? `/api/crm/upcoming?days=${encodeURIComponent(daysAhead)}`
    : "/api/crm/upcoming";
  const cached = getCached<UpcomingFeed>(feedUrl);
  const [calls, setCalls] = useState<Upcoming[]>(cached?.calls || []);
  const [callReminders, setCallReminders] = useState<CallReminder[]>(
    cached?.callReminders || []
  );
  const [recentlyCompleted, setRecentlyCompleted] = useState<Upcoming[]>(
    cached?.recentlyCompleted || []
  );
  const [adding, setAdding] = useState(false);
  const [prepId, setPrepId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [restoringId, setRestoringId] = useState("");
  const [saving, setSaving] = useState(false);

  // add-form state
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(
    null
  );
  const [when, setWhen] = useState("");
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState("");
  const [attendeeEmails, setAttendeeEmails] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [requestId, setRequestId] = useState("");
  // A dismissal must beat any read that started before the user pressed X.
  // Without this guard, a slower in-flight GET can repaint the removed event
  // for a moment even though the database write has already succeeded.
  const loadSeq = useRef(0);
  const dismissedIds = useRef(new Set<string>());

  const load = async () => {
    const seq = ++loadSeq.current;
    try {
      const d = await crmFetch<UpcomingFeed>(feedUrl);
      if (seq !== loadSeq.current) return;
      setCalls(
        (d.calls || []).filter((call) => !dismissedIds.current.has(call.id))
      );
      setCallReminders(d.callReminders || []);
      setRecentlyCompleted(d.recentlyCompleted || []);
    } catch {
      /* Keep the last confirmed list if a background refresh fails. */
    }
  };

  // Pull the latest from Google now (catches reschedules between the automatic
  // syncs). Needs Google connected in Settings.
  const syncNow = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await crmFetch<{
        added: number;
        updated: number;
        removed?: number;
        relinked?: number;
        reconciled?: boolean;
        calendarReconnectRequired?: boolean;
        warning?: string | null;
      }>(
        "/api/crm/calendar-sync",
        { method: "POST" }
      );
      await load();
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      const bits: string[] = [];
      if (r.added) bits.push(`${r.added} new`);
      if (r.updated) bits.push(`${r.updated} updated`);
      if (r.removed) bits.push(`${r.removed} cancelled removed`);
      if (r.relinked) bits.push(`${r.relinked} relinked`);
      if (r.calendarReconnectRequired)
        bits.push("reconnect Google once in Settings to include all calendars");
      else if (r.reconciled === false)
        bits.push("partial sync - cancellations kept safely");
      setSyncMsg(bits.length ? `synced - ${bits.join(", ")}` : "already up to date");
    } catch (e: any) {
      setSyncMsg(e?.message || "sync failed");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load();
    // Live-update: refresh when something elsewhere changed (a call ended,
    // a task ticked) and whenever you return to the tab, so a finished call
    // clears itself without a manual reload.
    const onRefresh = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden")
        return;
      load();
    };
    window.addEventListener("lc:tasks-updated", onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      window.removeEventListener("lc:tasks-updated", onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [feedUrl]);

  const create = async () => {
    if (!title.trim() && !company) return;
    if (addToCalendar && !when) {
      setSyncMsg("choose a date and time for the calendar event");
      return;
    }
    let stableRequestId = requestId;
    try {
      stableRequestId ||= newCalendarRequestId();
    } catch (error: any) {
      setSyncMsg(error?.message || "Secure event creation is unavailable");
      return;
    }
    if (!requestId) setRequestId(stableRequestId);
    setSaving(true);
    setSyncMsg("");
    try {
      const result = await crmFetch<{
        provider?: "google" | "microsoft" | null;
        calendarCreated?: boolean;
        invitesSent?: number;
      }>("/api/crm/upcoming", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          companyId: company?.id || null,
          scheduledAt: when ? new Date(when).toISOString() : null,
          meetingUrl: url.trim(),
          intent: intent.trim(),
          attendeeEmails,
          durationMinutes: Number(durationMinutes),
          addToCalendar,
          requestId: stableRequestId,
        }),
      });
      if (result.calendarCreated && result.provider) {
        const provider = result.provider === "google" ? "Google" : "Microsoft";
        const invites = result.invitesSent
          ? ` ${result.invitesSent} guest invite${result.invitesSent === 1 ? "" : "s"} sent.`
          : "";
        setSyncMsg(`added to ${provider} Calendar and LiveCoach.${invites}`);
      } else {
        setSyncMsg("saved in LiveCoach only");
      }
    } catch (e: any) {
      setSyncMsg(e?.message || "Call did not save. Please try again.");
      return;
    } finally {
      setSaving(false);
    }
    setTitle("");
    setCompany(null);
    setWhen("");
    setUrl("");
    setIntent("");
    setAttendeeEmails("");
    setDurationMinutes("30");
    setAddToCalendar(true);
    setRequestId("");
    setAdding(false);
    await load();
    window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
  };

  const patch = async (id: string, body: any) => {
    const previous = calls;
    setCalls((p) => p.map((c) => (c.id === id ? { ...c, ...body } : c)));
    try {
      const { call } = await crmFetch<{ call: any }>(`/api/crm/upcoming/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!call?.id)
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "PATCH",
          reason: "LiveCoach did not return the updated call",
        });
      if (typeof body.prepped === "boolean" && call.prepped !== body.prepped)
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "PATCH",
          reason: "LiveCoach returned a different preparation status from the one selected",
        });
      if (typeof body.intent === "string" && call.intent !== (body.intent.trim() || null))
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "PATCH",
          reason: "LiveCoach returned different call intent from the text saved",
        });
      if (
        typeof body.meetingUrl === "string" &&
        call.meeting_url !== (body.meetingUrl.trim() || null)
      )
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "PATCH",
          reason: "LiveCoach returned a different meeting link from the one saved",
        });
      setCalls((current) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                title: call.title,
                scheduled_at: call.scheduled_at,
                meeting_url: call.meeting_url,
                intent: call.intent,
                prepped: call.prepped,
                company_id: call.company_id,
              }
            : row
        )
      );
    } catch (e: any) {
      setCalls(previous);
      setSyncMsg(e?.message || "Change did not save. Please try again.");
    }
  };

  // Change (or set) the client on a scheduled call yourself. Auto-saves the
  // moment you pick, flips the chip straight away (optimistic), and nudges the
  // other lists to refresh, so a mis-linked call is fixed in one tap.
  const changeClient = async (
    id: string,
    v: { id: string; name: string } | null
  ) => {
    const previous = calls;
    setCalls((p) =>
      p.map((c) =>
        c.id === id
          ? { ...c, company_id: v?.id || null, company: v?.name || null }
          : c
      )
    );
    try {
      const { call } = await crmFetch<{ call: any }>(`/api/crm/upcoming/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ companyId: v?.id || null }),
      });
      if (call?.company_id !== (v?.id || null))
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm the selected client on this call",
        });
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch (e: any) {
      setCalls(previous);
      setSyncMsg(e?.message || "Client change did not save.");
    }
  };

  const remove = async (id: string) => {
    const previous = calls;
    loadSeq.current += 1;
    dismissedIds.current.add(id);
    setCalls((p) => p.filter((c) => c.id !== id));
    try {
      const result = await crmFetch<{ ok: boolean }>(`/api/crm/upcoming/${id}`, {
        method: "DELETE",
      });
      if (!result.ok)
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "DELETE",
          reason: "LiveCoach did not confirm that the call was removed",
        });
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch (e: any) {
      dismissedIds.current.delete(id);
      setCalls(previous);
      setSyncMsg(e?.message || "Call was not removed. Please try again.");
    }
  };

  // Mark a call as DONE (it happened) - clears it from upcoming without deleting
  // it. For calls you ran outside the app, or that never linked to a client, so
  // auto-complete couldn't tie the transcript back to the slot. Different from ✕
  // (delete) and from cancel (it did not happen).
  const markDone = async (id: string) => {
    const previous = calls;
    setCalls((p) => p.filter((c) => c.id !== id));
    try {
      const { call } = await crmFetch<{ call: any }>(`/api/crm/upcoming/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: true }),
      });
      if (!call?.completed_at)
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm that the call was marked complete",
        });
    } catch (e: any) {
      setCalls(previous);
      setSyncMsg(e?.message || "Call was not marked done. Please try again.");
      return;
    }
    // The dashboard's prep to-dos read completion too, so nudge a refresh.
    window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    await load();
  };

  const restore = async (id: string) => {
    setRestoringId(id);
    setSyncMsg("");
    try {
      const { call } = await crmFetch<{ call: any }>(`/api/crm/upcoming/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: false }),
      });
      if (!call?.id || call.completed_at !== null)
        throw crmConfirmationError({
          url: `/api/crm/upcoming/${id}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm that the call was restored",
        });
      await load();
      setSyncMsg("call restored to upcoming");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch (e: any) {
      setSyncMsg(e?.message || "Call could not be restored. Please try again.");
    } finally {
      setRestoringId("");
    }
  };

  const completeCallReminder = async (id: string) => {
    const previous = callReminders;
    setCallReminders((items) => items.filter((item) => item.id !== id));
    try {
      const { task } = await crmFetch<{ task: { id: string; status: string } }>(
        `/api/crm/tasks/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "done" }),
        }
      );
      if (task?.id !== id || task.status !== "done")
        throw crmConfirmationError({
          url: `/api/crm/tasks/${id}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm that the call reminder was completed",
        });
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch (error: any) {
      setCallReminders(previous);
      setSyncMsg(
        error?.message || "Call reminder was not completed. Please try again."
      );
    }
  };

  // Open the call screen preloaded from this scheduled call. The /call screen IS
  // the prep screen: it opens at the plan stage with this client, intent and link
  // already loaded, and only goes live when speech starts or you hit Go live. Both
  // "prep" and "start" route here - prep = prepare ahead, start = jump in now.
  const callHref = (c: Upcoming, launch = false) => {
    const qs = new URLSearchParams();
    if (c.company_id) qs.set("company", c.company_id);
    if (c.company) qs.set("companyName", c.company);
    if (c.intent) qs.set("intent", c.intent);
    if (c.meeting_url) qs.set("meetingUrl", c.meeting_url);
    // Tie this session to the scheduled call so the plan you build saves against
    // it and reloads next time you open prep.
    qs.set("upcoming", c.id);
    if (launch) qs.set("launch", "1");
    return `/call${qs.toString() ? `?${qs.toString()}` : ""}`;
  };

  // This is the deliberate, cost-bearing start action. Open the external
  // meeting directly inside the click handler so browser popup protection does
  // not block it, then move this tab into the matching LiveCoach session. The
  // one-use launch flag asks that screen to start this user's notetaker.
  const launchCall = (c: Upcoming) => {
    const meetingUrl = c.meeting_url?.trim() || "";
    if (!validMeetingUrl(meetingUrl)) {
      setSyncMsg("Add a supported Teams, Meet or Zoom link before starting.");
      setPrepId(c.id);
      return;
    }
    const armed = openAndArmCallLaunch(c.id, meetingUrl);
    router.push(callHref(c, armed));
  };

  const inputCls =
    "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.72rem] text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60";

  // Default to the soonest calls, with the rest behind an expand button. The
  // home dashboard supplies a seven-day feed while the Calls page deliberately
  // keeps the full future schedule available.
  const shown = showAll ? calls : calls.slice(0, limit);
  const hiddenCount = calls.length - shown.length;

  return (
    <div className="rounded-xl border border-edge bg-panel/40 p-4">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"▦"} Calls and reminders
        </p>
        <div className="mobile-full flex flex-wrap items-center justify-end gap-2 sm:w-auto">
          {syncMsg && (
            <span className="mr-auto font-mono text-[0.52rem] uppercase tracking-wider text-muted sm:mr-0">
              {syncMsg}
            </span>
          )}
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            title="Pull the latest from your Google calendar now"
            className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-sky/50 hover:text-sky disabled:opacity-40"
          >
            {syncing ? "syncing…" : "⟳ sync"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding((value) => {
                const next = !value;
                if (next && !requestId) setRequestId(newCalendarRequestId());
                return next;
              });
            }}
            className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
          >
            {adding ? "close" : "+ create event"}
          </button>
          {recentlyCompleted.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRecovery((value) => !value)}
              aria-expanded={showRecovery}
              aria-controls="recently-completed-calls"
              className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
            >
              {showRecovery
                ? "hide completed"
                : `recover calls · ${recentlyCompleted.length}`}
            </button>
          )}
        </div>
      </div>

      {showRecovery && recentlyCompleted.length > 0 && (
        <div
          id="recently-completed-calls"
          className="mb-3 rounded-lg border border-sage/35 bg-sage/[0.04] p-3"
        >
          <p className="font-mono text-[0.56rem] uppercase tracking-wider text-sage">
            Recently completed
          </p>
          <p className="mt-1 font-mono text-[0.54rem] leading-relaxed text-muted">
            Accidentally hidden a call? Restore it here and it returns to
            Upcoming Calls.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {recentlyCompleted.map((call) => (
              <li
                key={call.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-ink/40 px-3 py-2"
              >
                <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sky">
                  {fmtWhen(call.scheduled_at)}
                </span>
                <span className="min-w-[10rem] flex-1 text-sm text-bone">
                  {call.title || "Untitled call"}
                </span>
                <button
                  type="button"
                  onClick={() => void restore(call.id)}
                  disabled={restoringId === call.id}
                  className="rounded-full border border-sage/60 bg-sage/15 px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:opacity-40"
                >
                  {restoringId === call.id ? "restoring…" : "restore to upcoming"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {callReminders.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber/35 bg-amber/[0.04] p-3">
          <p className="font-mono text-[0.56rem] uppercase tracking-wider text-amber">
            Call reminders
          </p>
          <p className="mt-1 font-mono text-[0.54rem] leading-relaxed text-muted">
            Your dated call to-dos appear here automatically. Completing one here
            completes the same reminder everywhere in LiveCoach.
          </p>
          <ul className="mt-2 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
            {callReminders.map((reminder) => (
              <li
                key={reminder.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-ink/40 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => void completeCallReminder(reminder.id)}
                  title="Mark this call reminder complete"
                  aria-label={`Complete ${reminder.text}`}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-edge text-[0.6rem] leading-none text-muted transition hover:border-sage/60 hover:text-sage"
                >
                  ✓
                </button>
                <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sky">
                  {fmtReminderDate(reminder.dueAt)}
                </span>
                <span className="min-w-[12rem] flex-1 text-sm text-bone">
                  {reminder.text}
                </span>
                <Link
                  href="/crm/tasks"
                  className="rounded-full border border-edge px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
                >
                  open reminder ↗
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber/30 bg-amber/[0.04] p-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-edge bg-ink/35 p-3">
            <div className="min-w-[12rem] flex-1">
              <p className="font-mono text-[0.58rem] uppercase tracking-wider text-bone">
                {addToCalendar ? "Calendar + LiveCoach" : "LiveCoach only"}
              </p>
              <p className="mt-1 font-mono text-[0.52rem] leading-relaxed text-muted">
                {addToCalendar
                  ? "Creates one event in your connected Google or Microsoft calendar. Guest emails below receive the invitation."
                  : "Creates a private CRM reminder without changing your calendar or emailing guests."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={addToCalendar}
              onClick={() => setAddToCalendar((value) => !value)}
              className={`rounded-full border px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider transition ${
                addToCalendar
                  ? "border-sage/60 bg-sage/15 text-sage"
                  : "border-edge text-muted hover:border-amber/50 hover:text-amber"
              }`}
            >
              {addToCalendar ? "calendar on" : "calendar off"}
            </button>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title, e.g. Interviewa demo"
            className={inputCls}
          />
          <div className="flex flex-wrap items-center gap-2">
            <CompanyLinkPicker value={company} onChange={setCompany} />
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputCls}
            />
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className={inputCls}
              aria-label="Event duration"
            >
              {CALENDAR_DURATION_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes < 60
                    ? `${minutes} minutes`
                    : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </div>
          <input
            value={attendeeEmails}
            onChange={(e) => setAttendeeEmails(e.target.value)}
            placeholder="Guest emails, separated by commas"
            inputMode="email"
            className={inputCls}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Meet / Teams / Zoom link (optional)"
              className={inputCls}
            />
            <p className="self-center font-mono text-[0.52rem] leading-relaxed text-muted">
              The call intent stays private in LiveCoach. It is never included in the guest invitation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
              intent
            </span>
            <span className="ml-auto">
              <VoiceNoteButton
                onText={(t) =>
                  setIntent((p) => (p.trim() ? `${p.trim()} ${t}` : t))
                }
              />
            </span>
          </div>
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={4}
            placeholder="What do you want from this call? (you can prep this later too)"
            className={`${inputCls} resize-y font-sans text-sm`}
          />
          <button
            type="button"
            onClick={create}
            disabled={
              saving ||
              (!title.trim() && !company) ||
              (addToCalendar && !when)
            }
            className="self-start rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
          >
            {saving
              ? "creating…"
              : addToCalendar
                ? "create calendar event"
                : "save CRM reminder"}
          </button>
        </div>
      )}

      {calls.length === 0 ? (
        <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
          {callReminders.length
            ? "No meetings scheduled. Your call reminders are shown above."
            : "Nothing scheduled. Add an upcoming call to prep it in advance and jump straight in when it's time. Calendar events created here stay linked to the same private CRM record."}
        </p>
      ) : (
        <>
        <ul className="flex flex-col gap-2">
          {shown.map((c) => {
            const canMarkDone =
              !c.scheduled_at ||
              new Date(c.scheduled_at).getTime() <= Date.now() + 15 * 60 * 1000;
            return (
            <li
              key={c.id}
              className="rounded-lg border border-edge bg-ink/40 px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  type="button"
                  onClick={() => patch(c.id, { prepped: !c.prepped })}
                  title={c.prepped ? "prepped - click to unset" : "mark as prepped"}
                  aria-label="toggle prepped"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[0.6rem] leading-none transition ${
                    c.prepped
                      ? "border-sky bg-sky text-ink"
                      : "border-edge text-muted hover:border-sky/60 hover:text-bone"
                  }`}
                >
                  {c.prepped ? "✓" : ""}
                </button>
                <span className="font-mono text-[0.6rem] uppercase tracking-wider text-sky">
                  {fmtWhen(c.scheduled_at)}
                </span>
                <span className="min-w-[11rem] flex-1 font-sans text-[0.9rem] text-bone">
                  {c.title || "Untitled call"}
                  {c.company && c.company_id ? (
                    <Link href={`/crm/${c.company_id}`} className="ml-1.5 font-mono text-[0.6rem] text-sky hover:text-amber hover:underline">
                      · {c.company}
                    </Link>
                  ) : c.company ? (
                    <span className="ml-1.5 font-mono text-[0.6rem] text-muted">· {c.company}</span>
                  ) : null}
                </span>
                <Link
                  href={callHref(c)}
                  title={
                    c.prepped
                      ? "Prepped and ready. Tap to review the prep again."
                      : "Review past call summaries and get a fresh, suggested intent for this call before you go in."
                  }
                  className={`rounded-full border px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider transition ${
                    c.prepped
                      ? "border-amber bg-amber text-ink hover:bg-amber/90"
                      : "border-amber/60 bg-amber/15 text-amber hover:bg-amber/25"
                  }`}
                >
                  {c.prepped ? "prepped ✓" : "prep ▸"}
                </Link>
                <button
                  type="button"
                  onClick={() => launchCall(c)}
                  title="Open the meeting, start LiveCoach and request your notetaker"
                  className="rounded-full border border-sage/60 bg-sage/15 px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
                >
                  start call ▸
                </button>
                <button
                  type="button"
                  onClick={() => markDone(c.id)}
                  disabled={!canMarkDone}
                  title={
                    canMarkDone
                      ? "Mark this call as done. You can restore it from Recover calls."
                      : "Available 15 minutes before the meeting. This prevents a future call being hidden accidentally."
                  }
                  className="rounded-full border border-edge bg-bone/[0.04] px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:border-sage/60 hover:text-sage disabled:cursor-not-allowed disabled:opacity-35"
                >
                  done ✓
                </button>
                <button
                  type="button"
                  onClick={() => setPrepId(prepId === c.id ? "" : c.id)}
                  className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-amber"
                >
                  {prepId === c.id ? "hide" : "edit"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  title="Hide this from LiveCoach. It stays in your calendar."
                  aria-label={`Hide ${c.title || "calendar event"} from LiveCoach`}
                  className="font-mono text-[0.7rem] text-muted transition hover:text-rust"
                >
                  ✕
                </button>
              </div>

              {prepId === c.id && (
                <div className="mt-2.5 flex flex-col gap-2 border-t border-edge/50 pt-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 font-mono text-[0.54rem] uppercase tracking-wider text-muted">
                      Client
                    </span>
                    <div className="min-w-0 flex-1">
                      <CompanyLinkPicker
                        value={
                          c.company_id
                            ? { id: c.company_id, name: c.company || "client" }
                            : null
                        }
                        onChange={(v) => changeClient(c.id, v)}
                      />
                    </div>
                  </div>
                  <textarea
                    defaultValue={c.intent || ""}
                    rows={2}
                    placeholder="Intent / what you want from this call"
                    onBlur={(e) => patch(c.id, { intent: e.target.value })}
                    className={`${inputCls} resize-y font-sans text-sm`}
                  />
                  <input
                    defaultValue={c.meeting_url || ""}
                    placeholder="Meeting link"
                    onBlur={(e) => patch(c.id, { meetingUrl: e.target.value })}
                    className={inputCls}
                  />
                  <p className="font-mono text-[0.54rem] leading-relaxed text-muted">
                    Saved when you click away. Set the intent here, then mark it
                    prepped - Start opens the call with this client, link and
                    intent already loaded.
                  </p>
                </div>
              )}
            </li>
            );
          })}
        </ul>
        {calls.length > limit && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2.5 w-full rounded-lg border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
          >
            {showAll ? "show less" : `show all ${calls.length}`}
          </button>
        )}
        </>
      )}
    </div>
  );
}
