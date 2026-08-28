"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { crmFetch, getCached, setCached } from "@/lib/crm";
import { capitaliseSentenceStarts } from "@/lib/text";

type Task = {
  id: string;
  company_id: string | null;
  company: string | null;
  text: string;
  kind: string;
  link_kind: string | null;
  status: string;
  done_at: string | null;
  // Set on prep to-dos derived from an upcoming client call.
  upcoming_id?: string | null;
  scheduled_at?: string | null;
  meeting_url?: string | null;
  intent?: string | null;
  due_soon?: boolean;
  // A deadline (sorts the list) and whether the user pinned it to the top.
  due_at?: string | null;
  // When an intent has more than one way to act it (e.g. call OR email the same
  // person), payload.approaches lists them and clicking asks which to use.
  // payload.pinned keeps the to-do at the top of the list until it's done.
  payload?: {
    approaches?: string[];
    pinned?: boolean;
    crossRelationship?: boolean;
    sourceCallId?: string;
    sourceLabel?: string;
    [k: string]: any;
  } | null;
};

// "Fri 19", "today", "overdue" for a deadline.
const dueLabel = (iso?: string | null): { text: string; over: boolean } | null => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const over = dDay < startToday;
    let text: string;
    if (dDay === startToday) text = "today";
    else if (dDay === startToday + day) text = "tomorrow";
    else if (over) text = "overdue";
    else
      text = d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      });
    return { text, over };
  } catch {
    return null;
  }
};

// "today 14:00" / "Tue 24 Jun 14:00" for a prep to-do's call time. Always
// carries the real date once it's past today, so a list of calls is never just
// a column of weekday names with no idea which date each one is.
const whenLabel = (iso?: string | null) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) return `today ${t}`;
    const date = d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
    return `${date} ${t}`;
  } catch {
    return "";
  }
};

// A tickable to-do list backed by the tasks table.
// - Tick the box to mark done and remove it from every open-work view.
// - The separate ✕ removes a task for good.
// - Clicking the text starts the action: email -> opens the assistant to draft
//   it, call -> starts a preloaded call, anything else -> opens the client.
export default function TaskList({
  companyId,
  showCompany = false,
  emptyText = "Nothing on your plate. Nice.",
  hideCommitments = false,
  clientlessOnly = false,
  allowBulk = false,
}: {
  companyId?: string;
  showCompany?: boolean;
  emptyText?: string;
  // On the dashboard, commitments are shown in "You promised" above, so the
  // "Do next" list hides them to avoid duplicating the same item in both.
  hideCommitments?: boolean;
  // The dashboard groups client-linked to-dos under Opportunities, so its
  // "Do next" list shows ONLY the loose, client-less to-dos to avoid repeats.
  clientlessOnly?: boolean;
  // Dashboard and full-list views can enter a selection mode and remove many
  // stale tasks in one recoverable, owner-scoped save.
  allowBulk?: boolean;
}) {
  const router = useRouter();
  const url = `/api/crm/tasks${companyId ? `?companyId=${companyId}` : ""}`;
  const cached = getCached<{ tasks: Task[] }>(url);
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks || []);
  // Task id currently showing its "which approach?" chooser (call vs email).
  const [choosing, setChoosing] = useState<string | null>(null);
  // Prep calls more than a week out are collapsed behind an expand, so the list
  // stays focused on the week ahead instead of a wall of future recurring preps.
  const [showLater, setShowLater] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // A confirmed close must win over any list request that began before it.
  const loadSeq = useRef(0);
  const closedIds = useRef(new Set<string>());

  const showTasks = (next: Task[]) => {
    setTasks(next);
    setCached(url, { tasks: next });
  };

  const loadTasks = async () => {
    const seq = ++loadSeq.current;
    const d = await crmFetch<{ tasks: Task[] }>(url);
    if (seq !== loadSeq.current) return [];
    const next = (d.tasks || []).filter((task) => !closedIds.current.has(task.id));
    showTasks(next);
    const nextIds = new Set(next.map((task) => task.id));
    setSelectedIds((current) => current.filter((id) => nextIds.has(id)));
    return next;
  };

  const savedEverywhere = () => {
    window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
  };

  useEffect(() => {
    loadTasks().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Refresh when something elsewhere creates to-dos (the assistant, or the
  // post-call voice debrief) so new items appear without a manual reload.
  useEffect(() => {
    const onUpd = () => loadTasks().catch(() => {});
    window.addEventListener("lc:tasks-updated", onUpd);
    return () => window.removeEventListener("lc:tasks-updated", onUpd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const toggle = async (t: Task) => {
    const previous = tasks;
    loadSeq.current += 1;
    closedIds.current.add(t.id);
    setSaveError("");
    showTasks(tasks.filter((x) => x.id !== t.id));
    // A prep to-do is derived from an upcoming call: ticking it marks that call
    // prepped, which drops it off the list, rather than writing a tasks row.
    if (t.upcoming_id) {
      try {
        setSavingId(t.id);
        await crmFetch(`/api/crm/upcoming/${t.upcoming_id}`, {
          method: "PATCH",
          body: JSON.stringify({ prepped: true }),
        });
        savedEverywhere();
      } catch {
        closedIds.current.delete(t.id);
        showTasks(previous);
        setSaveError("That change did not save. Please try again.");
      } finally {
        setSavingId(null);
      }
      return;
    }
    try {
      setSavingId(t.id);
      const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      });
      if (result.task?.status !== "done") throw new Error("status not saved");
      savedEverywhere();
    } catch {
      closedIds.current.delete(t.id);
      showTasks(previous);
      setSaveError("That change did not save. Please try again.");
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (t: Task) => {
    // Dismiss (not hard-delete) so it disappears from the whole pipeline and the
    // background jobs don't re-create it from the same email/call.
    const previous = tasks;
    loadSeq.current += 1;
    closedIds.current.add(t.id);
    setSaveError("");
    showTasks(tasks.filter((x) => x.id !== t.id));
    try {
      setSavingId(t.id);
      if (t.upcoming_id) {
        const result = await crmFetch<{ ok: boolean }>(
          `/api/crm/upcoming/${t.upcoming_id}`,
          {
            method: "DELETE",
          }
        );
        if (!result.ok) {
          throw new Error("calendar exclusion was not confirmed");
        }
      } else {
        const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "dismissed" }),
        });
        if (result.task?.status !== "dismissed")
          throw new Error("status not saved");
      }
      savedEverywhere();
    } catch {
      closedIds.current.delete(t.id);
      showTasks(previous);
      setSaveError("That change did not save. Please try again.");
    } finally {
      setSavingId(null);
    }
  };

  const beginEdit = (t: Task) => {
    if (t.upcoming_id) return;
    setEditingId(t.id);
    setEditText(t.text);
    setSaveError("");
  };

  const saveEdit = async (t: Task) => {
    const text = editText.trim();
    if (!text) return;
    if (text === t.text) {
      setEditingId(null);
      return;
    }
    const previous = tasks;
    loadSeq.current += 1;
    showTasks(tasks.map((x) => (x.id === t.id ? { ...x, text } : x)));
    setEditingId(null);
    setSavingId(t.id);
    try {
      const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      });
      if (result.task?.text !== text) throw new Error("text not saved");
      savedEverywhere();
    } catch {
      showTasks(previous);
      setSaveError("That edit did not save. Please try again.");
    } finally {
      setSavingId(null);
    }
  };

  // Pin / unpin a to-do so it stays at the top of the list until done. Re-fetch
  // after so the server's priority sort re-orders it.
  const togglePin = async (t: Task) => {
    if (t.upcoming_id) return; // prep to-dos aren't pinnable
    const previous = tasks;
    loadSeq.current += 1;
    const pinned = !t.payload?.pinned;
    const payload = { ...(t.payload || {}), pinned };
    showTasks(tasks.map((x) => (x.id === t.id ? { ...x, payload } : x)));
    setSavingId(t.id);
    setSaveError("");
    try {
      const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ payload }),
      });
      if (Boolean(result.task?.payload?.pinned) !== pinned)
        throw new Error("pin not saved");
      savedEverywhere();
    } catch {
      showTasks(previous);
      setSaveError("That pin did not save. Please try again.");
    } finally {
      setSavingId(null);
    }
  };

  // What clicking the task text does. If the intent has more than one approach
  // (call OR email), ask which first; otherwise just run its action.
  const start = (t: Task) => {
    const approaches = Array.isArray(t.payload?.approaches)
      ? (t.payload!.approaches as string[])
      : [];
    if (approaches.length > 1) {
      setChoosing((c) => (c === t.id ? null : t.id));
      return;
    }
    runAction(t, t.link_kind || "task");
  };

  // Run a specific action for a task.
  const runAction = (t: Task, a: string) => {
    setChoosing(null);
    if (a === "email") {
      window.dispatchEvent(
        new CustomEvent("lc:draft-email", {
          detail: {
            companyId: t.company_id,
            companyName: t.company,
            text: t.text,
            taskId: t.id,
          },
        })
      );
      return;
    }
    if (a === "call") {
      const q = new URLSearchParams();
      if (t.company_id) q.set("company", t.company_id);
      if (t.company) q.set("companyName", t.company);
      // Prefer the call's own intent; only fall back to the task text for a
      // plain manual call task (not a "Prep: ..." label).
      const intentVal = t.intent || (t.upcoming_id ? "" : t.text);
      if (intentVal) q.set("intent", intentVal);
      if (t.meeting_url) q.set("meetingUrl", t.meeting_url);
      // Tie it to the scheduled call so the plan saves + reloads against it.
      if (t.upcoming_id) q.set("upcoming", t.upcoming_id);
      return router.push(`/call?${q.toString()}`);
    }
    if (a === "drafts") return router.push("/crm/board?tab=drafts");
    // task / client: open the client - unless we're already on that client page.
    if (t.company_id && t.company_id !== companyId) {
      return router.push(`/crm/${t.company_id}`);
    }
  };

  const chip = (a: string | null) => {
    if (a === "email")
      return { label: "draft email", icon: "ti-mail", bg: "var(--color-background-info)", fg: "var(--color-text-info)" };
    if (a === "call")
      return { label: "prep call", icon: "ti-player-play", bg: "var(--color-background-warning)", fg: "var(--color-text-warning)" };
    if (a === "drafts")
      return { label: "draft", icon: "ti-mail", bg: "var(--color-background-info)", fg: "var(--color-text-info)" };
    return null;
  };

  const actionable = (t: Task) => {
    const a = t.link_kind || "task";
    if (a === "email" || a === "call" || a === "drafts") return true;
    return !!(t.company_id && t.company_id !== companyId);
  };

  // Commitments live in "You promised"; drop them here when asked so the same
  // item never appears in both lists. clientlessOnly keeps just the loose
  // to-dos (the client-linked ones are grouped under Opportunities).
  // Counterparty promises are relationship state, not work for the user. They
  // belong only in the Commitments tracker and must never inflate Do next.
  let shown = tasks.filter((t) => t.kind !== "counterparty_commitment");
  shown = hideCommitments
    ? shown.filter((t) => t.kind !== "commitment")
    : shown;
  if (clientlessOnly) shown = shown.filter((t) => !t.company_id);

  // Prep calls more than a week out collapse behind an expand, so the list
  // stays on the week ahead rather than a wall of future recurring preps.
  const weekAhead = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const isLaterPrep = (t: Task) =>
    !!t.upcoming_id &&
    !!t.scheduled_at &&
    new Date(t.scheduled_at).getTime() > weekAhead;
  const later = shown.filter(isLaterPrep);
  const near = shown.filter((t) => !isLaterPrep(t));
  const visible = showLater ? [...near, ...later] : near;
  const selectable = visible.filter(
    (task) => !task.upcoming_id && task.status === "open"
  );
  const allSelectableSelected =
    selectable.length > 0 && selectable.every((task) => selectedIds.includes(task.id));

  const toggleSelected = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id]
    );
  };

  const dismissSelected = async () => {
    if (!selectedIds.length || savingId) return;
    const selected = [...selectedIds];
    setSavingId("bulk");
    setSaveError("");
    try {
      const result = await crmFetch<{ updatedIds: string[]; skippedIds: string[] }>(
        "/api/crm/tasks/bulk",
        { method: "POST", body: JSON.stringify({ taskIds: selected }) }
      );
      const updated = new Set(result.updatedIds || []);
      if (!updated.size) throw new Error("No selected to-dos were removed");
      updated.forEach((id) => closedIds.current.add(id));
      showTasks(tasks.filter((task) => !updated.has(task.id)));
      setSelectedIds([]);
      setBulkMode(false);
      savedEverywhere();
      if (result.skippedIds?.length) {
        setSaveError(`${result.skippedIds.length} item changed elsewhere and was left alone.`);
      }
    } catch (error: any) {
      setSaveError(error?.message || "The selected to-dos did not save. Please try again.");
    } finally {
      setSavingId(null);
    }
  };

  if (shown.length === 0) {
    return (
      <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
        {emptyText}
      </p>
    );
  }

  return (
    <>
    {saveError ? (
      <p className="mb-2 rounded-md border border-rust/50 bg-rust/10 px-2 py-1.5 font-sans text-[0.76rem] text-rust">
        {saveError}
      </p>
    ) : null}
    {allowBulk && selectable.length ? (
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-ink/30 px-2.5 py-2">
        <p className="text-xs text-muted">
          {bulkMode ? `${selectedIds.length} selected` : `${selectable.length} open to-dos`}
        </p>
        <div className="flex flex-wrap gap-2">
          {!bulkMode ? (
            <button type="button" onClick={() => setBulkMode(true)} className="min-h-9 rounded-md border border-edge px-3 font-mono text-[0.52rem] uppercase text-muted hover:text-bone">Select items</button>
          ) : (
            <>
              <button type="button" onClick={() => setSelectedIds(allSelectableSelected ? [] : selectable.map((task) => task.id))} disabled={Boolean(savingId)} className="min-h-9 rounded-md border border-edge px-3 font-mono text-[0.52rem] uppercase text-muted disabled:opacity-40">{allSelectableSelected ? "Clear all" : "Select all"}</button>
              <button type="button" onClick={() => { setBulkMode(false); setSelectedIds([]); }} disabled={Boolean(savingId)} className="min-h-9 rounded-md border border-edge px-3 font-mono text-[0.52rem] uppercase text-muted disabled:opacity-40">Cancel</button>
              <button type="button" onClick={() => void dismissSelected()} disabled={Boolean(savingId) || !selectedIds.length} className="min-h-9 rounded-md border border-rust/50 bg-rust/10 px-3 font-mono text-[0.52rem] uppercase text-rust disabled:opacity-40">{savingId === "bulk" ? "Removing…" : `Remove ${selectedIds.length}`}</button>
            </>
          )}
        </div>
      </div>
    ) : null}
    <ul className="flex flex-col">
      {visible.map((t) => {
        const done = t.status === "done";
        const c = chip(t.link_kind);
        const approaches = Array.isArray(t.payload?.approaches)
          ? (t.payload!.approaches as string[])
          : [];
        const multi = approaches.length > 1;
        const canClick = multi || actionable(t);
        const pinned = !!t.payload?.pinned;
        const dl = !t.upcoming_id ? dueLabel(t.due_at) : null;
        return (
          <li
            key={t.id}
            className="flex items-center gap-2.5 border-b border-edge/40 py-2 last:border-none"
          >
            {!bulkMode && !t.upcoming_id && (
              <button
                type="button"
                onClick={() => togglePin(t)}
                title={pinned ? "unpin from top" : "pin to top"}
                className={`flex-none font-mono text-[0.82rem] leading-none transition ${
                  pinned ? "text-amber" : "text-muted/40 hover:text-amber"
                }`}
              >
                {pinned ? "★" : "☆"}
              </button>
            )}
            <button
              type="button"
              onClick={() => bulkMode && !t.upcoming_id ? toggleSelected(t.id) : toggle(t)}
              disabled={bulkMode && Boolean(t.upcoming_id)}
              title={bulkMode ? "select to remove" : done ? "tick to un-complete" : "mark done"}
              className={`flex h-4 w-4 flex-none items-center justify-center rounded border text-[0.6rem] transition ${
                bulkMode && selectedIds.includes(t.id)
                  ? "border-rust bg-rust text-ink"
                  : done
                  ? "border-sage bg-sage text-ink"
                  : "border-muted hover:border-sage"
              }`}
            >
              {bulkMode && selectedIds.includes(t.id) ? "✓" : done ? "✓" : ""}
            </button>

            {editingId === t.id ? (
              <input
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => saveEdit(t)}
                aria-label="Edit task"
                className="min-w-0 flex-1 rounded-md border border-amber/50 bg-ink/70 px-2 py-1.5 font-sans text-[0.84rem] text-bone outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => canClick && start(t)}
                disabled={!canClick || savingId === t.id}
                className={`flex-1 text-left font-sans text-[0.84rem] leading-snug transition ${
                  done
                    ? "text-muted line-through"
                    : canClick
                    ? "text-bone hover:text-amber hover:underline"
                    : "cursor-default text-bone"
                }`}
              >
                {capitaliseSentenceStarts(t.text)}
              </button>
            )}

            {dl && !done && (
              <span
                title="deadline"
                className={`flex-none rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider ${
                  dl.over
                    ? "border border-rust/60 bg-rust/15 text-rust"
                    : "border border-amber/50 bg-amber/10 text-amber"
                }`}
              >
                {dl.text}
              </span>
            )}

            {t.upcoming_id && t.scheduled_at && (
              <span
                title={t.due_soon ? "within 48 hours - prep now" : "upcoming call"}
                className={`flex-none rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider ${
                  t.due_soon
                    ? "border border-amber/60 bg-amber/15 text-amber"
                    : "border border-edge text-muted"
                }`}
              >
                {t.due_soon ? "▲ " : ""}
                {whenLabel(t.scheduled_at)}
              </span>
            )}
            {/* Multi-approach: clicking the text opens this Call / Email choice. */}
            {multi && !done && choosing === t.id && (
              <span className="flex flex-none items-center gap-1">
                <button
                  type="button"
                  onClick={() => runAction(t, "email")}
                  className="rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider"
                  style={{ background: "var(--color-background-info)", color: "var(--color-text-info)" }}
                >
                  <i className="ti ti-mail" aria-hidden="true" /> email
                </button>
                <button
                  type="button"
                  onClick={() => runAction(t, "call")}
                  className="rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider"
                  style={{ background: "var(--color-background-warning)", color: "var(--color-text-warning)" }}
                >
                  <i className="ti ti-player-play" aria-hidden="true" /> call
                </button>
              </span>
            )}
            {multi && !done && choosing !== t.id && (
              <span
                className="flex-none rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider"
                style={{ background: "var(--color-background-info)", color: "var(--color-text-info)" }}
              >
                call or email
              </span>
            )}
            {!multi && c && !done && (
              <span
                className="flex-none rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider"
                style={{ background: c.bg, color: c.fg }}
              >
                <i className={`ti ${c.icon}`} aria-hidden="true" /> {c.label}
              </span>
            )}
            {showCompany && t.company && (
              <Link
                href={t.company_id ? `/crm/${t.company_id}` : "/crm/board?tab=clients"}
                className="flex-none font-mono text-[0.58rem] text-sky hover:text-amber hover:underline"
              >
                {t.company}
              </Link>
            )}
            {t.payload?.crossRelationship && t.payload.sourceCallId ? (
              <Link
                href={`/crm/calls/${t.payload.sourceCallId}`}
                title={`Connected through ${t.payload.sourceLabel || "another call"}`}
                className="flex-none rounded-full border border-violet-400/35 bg-violet-400/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-violet-200 hover:border-violet-300/60"
              >
                via {t.payload.sourceLabel || "related call"} ↗
              </Link>
            ) : null}

            {/* Prep to-dos are derived from the call, so there's no row to
                delete - you complete them by ticking (marks the call prepped)
                or they roll off once the call has passed. */}
            {!bulkMode && !t.upcoming_id && (
              <button
                type="button"
                onClick={() => beginEdit(t)}
                disabled={savingId === t.id}
                aria-label="edit task"
                title="edit"
                className="flex-none font-mono text-[0.64rem] text-muted transition hover:text-amber disabled:opacity-40"
              >
                edit
              </button>
            )}
            {!bulkMode && !t.upcoming_id && (
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label="remove task"
                title="remove"
                disabled={savingId === t.id}
                className="flex-none font-mono text-[0.7rem] text-muted transition hover:text-rust disabled:opacity-40"
              >
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ul>
      {later.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLater((v) => !v)}
          className="mt-1 self-start font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:text-amber"
        >
          {showLater
            ? "show less"
            : `+ ${later.length} more prep beyond this week`}
        </button>
      )}
    </>
  );
}
