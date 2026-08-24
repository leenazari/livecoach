"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";
import VoiceNoteButton from "@/components/VoiceNoteButton";

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
  recentlyCompleted?: Upcoming[];
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

export default function UpcomingCalls({ limit = 10 }: { limit?: number }) {
  const router = useRouter();
  const cached = getCached<UpcomingFeed>("/api/crm/upcoming");
  const [calls, setCalls] = useState<Upcoming[]>(cached?.calls || []);
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

  // add-form state
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(
    null
  );
  const [when, setWhen] = useState("");
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState("");

  const load = () =>
    crmFetch<UpcomingFeed>("/api/crm/upcoming")
      .then((d) => {
        setCalls(d.calls || []);
        setRecentlyCompleted(d.recentlyCompleted || []);
      })
      .catch(() => {});

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
      if (r.reconciled === false) bits.push("partial sync - cancellations kept safely");
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
  }, []);

  const create = async () => {
    if (!title.trim() && !company) return;
    try {
      await crmFetch("/api/crm/upcoming", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          companyId: company?.id || null,
          scheduledAt: when ? new Date(when).toISOString() : null,
          meetingUrl: url.trim(),
          intent: intent.trim(),
        }),
      });
    } catch (e: any) {
      setSyncMsg(e?.message || "Call did not save. Please try again.");
      return;
    }
    setTitle("");
    setCompany(null);
    setWhen("");
    setUrl("");
    setIntent("");
    setAdding(false);
    load();
  };

  const patch = async (id: string, body: any) => {
    const previous = calls;
    setCalls((p) => p.map((c) => (c.id === id ? { ...c, ...body } : c)));
    try {
      const { call } = await crmFetch<{ call: any }>(`/api/crm/upcoming/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!call?.id) throw new Error("database did not confirm the call update");
      if (typeof body.prepped === "boolean" && call.prepped !== body.prepped)
        throw new Error("prep status was not confirmed");
      if (typeof body.intent === "string" && call.intent !== (body.intent.trim() || null))
        throw new Error("intent was not confirmed");
      if (
        typeof body.meetingUrl === "string" &&
        call.meeting_url !== (body.meetingUrl.trim() || null)
      )
        throw new Error("meeting link was not confirmed");
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
        throw new Error("database did not confirm the client link");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch (e: any) {
      setCalls(previous);
      setSyncMsg(e?.message || "Client change did not save.");
    }
  };

  const remove = async (id: string) => {
    const previous = calls;
    setCalls((p) => p.filter((c) => c.id !== id));
    try {
      await crmFetch(`/api/crm/upcoming/${id}`, { method: "DELETE" });
    } catch (e: any) {
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
      if (!call?.completed_at) throw new Error("database did not confirm completion");
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
        throw new Error("database did not confirm the restored call");
      await load();
      setSyncMsg("call restored to upcoming");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch (e: any) {
      setSyncMsg(e?.message || "Call could not be restored. Please try again.");
    } finally {
      setRestoringId("");
    }
  };

  // Open the call screen preloaded from this scheduled call. The /call screen IS
  // the prep screen: it opens at the plan stage with this client, intent and link
  // already loaded, and only goes live when speech starts or you hit Go live. Both
  // "prep" and "start" route here - prep = prepare ahead, start = jump in now.
  const openCall = (c: Upcoming) => {
    const qs = new URLSearchParams();
    if (c.company_id) qs.set("company", c.company_id);
    if (c.company) qs.set("companyName", c.company);
    if (c.intent) qs.set("intent", c.intent);
    if (c.meeting_url) qs.set("meetingUrl", c.meeting_url);
    // Tie this session to the scheduled call so the plan you build saves against
    // it and reloads next time you open prep.
    qs.set("upcoming", c.id);
    router.push(`/call${qs.toString() ? `?${qs.toString()}` : ""}`);
  };

  // Open the dedicated prep screen for this call: past call summaries plus a
  // suggested, up-to-date intent. Needs a linked client (that's what the history
  // and suggestion read from), so fall back to opening the call screen if none.
  const openPrep = (c: Upcoming) => {
    if (!c.company_id) return openCall(c);
    const qs = new URLSearchParams();
    qs.set("company", c.company_id);
    if (c.company) qs.set("companyName", c.company);
    qs.set("upcoming", c.id);
    router.push(`/crm/prep?${qs.toString()}`);
  };

  const inputCls =
    "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.72rem] text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60";

  // Default to the soonest 10 calls, with the rest behind an expand button, so
  // the dashboard stays condensed once the calendar fills up. The list arrives
  // already sorted soonest-first.
  const shown = showAll ? calls : calls.slice(0, limit);
  const hiddenCount = calls.length - shown.length;

  return (
    <div className="rounded-xl border border-edge bg-panel/40 p-4">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"▦"} Upcoming calls
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
            onClick={() => setAdding((v) => !v)}
            className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
          >
            {adding ? "close" : "+ schedule"}
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

      {adding && (
        <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber/30 bg-amber/[0.04] p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Call title, e.g. Onboarding sync"
            className={inputCls}
          />
          <div className="flex flex-wrap items-center gap-2">
            <CompanyLinkPicker value={company} onChange={setCompany} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputCls}
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Meet / Teams / Zoom link (optional)"
              className={inputCls}
            />
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
            disabled={!title.trim() && !company}
            className="self-start rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
          >
            schedule call
          </button>
        </div>
      )}

      {calls.length === 0 ? (
        <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
          Nothing scheduled. Add an upcoming call to prep it in advance and jump
          straight in when it's time. (Google Calendar sync comes next.)
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
                <button
                  type="button"
                  onClick={() => openPrep(c)}
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
                </button>
                <button
                  type="button"
                  onClick={() => openCall(c)}
                  title="Jump straight into the live call (same screen, ready to go)"
                  className="rounded-full border border-sage/60 bg-sage/15 px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
                >
                  start ▸
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
                  onClick={() => remove(c.id)}
                  title="delete"
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
