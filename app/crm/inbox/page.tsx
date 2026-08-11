"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import { capitaliseSentenceStarts } from "@/lib/text";
import MatrixRain from "@/components/MatrixRain";
import type {
  WorkCleanupSuggestion,
  WorkInboxItem,
  WorkInboxResponse,
} from "@/lib/work-inbox";

type Filter =
  | "now"
  | "revenue"
  | "approvals"
  | "waiting"
  | "cleanup"
  | "all"
  | "done";

const filters: { key: Filter; label: string }[] = [
  { key: "now", label: "Do now" },
  { key: "revenue", label: "Revenue" },
  { key: "approvals", label: "Approvals" },
  { key: "waiting", label: "Waiting" },
  { key: "cleanup", label: "Clean up" },
  { key: "all", label: "All work" },
  { key: "done", label: "Done" },
];

const kindCopy: Record<WorkInboxItem["kind"], { label: string; icon: string }> = {
  task: { label: "Task", icon: "✓" },
  prep: { label: "Call prep", icon: "☎" },
  follow_up: { label: "Email draft", icon: "✉" },
  outreach: { label: "Outreach", icon: "↗" },
  reply: { label: "Buyer reply", icon: "◆" },
  client_update: { label: "Client update", icon: "◴" },
};

const priorityStyle: Record<WorkInboxItem["priorityLabel"], string> = {
  urgent: "border-rust/55 bg-rust/10 text-rust",
  high: "border-amber/55 bg-amber/10 text-amber",
  normal: "border-sky/40 bg-sky/[0.07] text-sky",
  waiting: "border-edge bg-ink/35 text-muted",
  done: "border-moss/35 bg-moss/[0.06] text-moss",
};

const cleanupCopy: Record<
  WorkCleanupSuggestion["kind"],
  { label: string; icon: string; style: string }
> = {
  duplicate: {
    label: "Duplicate",
    icon: "≡",
    style: "border-sky/45 bg-sky/[0.08] text-sky",
  },
  stale: {
    label: "Stale",
    icon: "○",
    style: "border-rust/45 bg-rust/[0.08] text-rust",
  },
  needs_date: {
    label: "Needs deadline",
    icon: "◷",
    style: "border-amber/45 bg-amber/[0.08] text-amber",
  },
  waiting: {
    label: "Check waiting",
    icon: "…",
    style: "border-edge bg-ink/35 text-muted",
  },
};

const formatWhen = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const belongsTo = (item: WorkInboxItem, filter: Filter) => {
  if (filter === "now")
    return !item.done && !item.waiting && item.priority >= 78;
  if (filter === "revenue") return !item.done && item.revenue;
  if (filter === "approvals") return !item.done && item.approval;
  if (filter === "waiting") return !item.done && item.waiting;
  if (filter === "cleanup") return false;
  if (filter === "all") return !item.done;
  return item.done;
};

export default function WorkInboxPage() {
  const [data, setData] = useState<WorkInboxResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("now");
  const [visible, setVisible] = useState(10);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedCleanup, setSelectedCleanup] = useState<string[]>([]);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupFailures, setCleanupFailures] = useState<
    { id: string; reason: string }[]
  >([]);
  const [undoTaskIds, setUndoTaskIds] = useState<string[]>([]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await crmFetch<WorkInboxResponse>("/api/crm/inbox");
      setData(next);
      const currentSuggestionIds = new Set(
        next.cleanup?.suggestions?.map((suggestion) => suggestion.id) || []
      );
      setSelectedCleanup((current) =>
        current.filter((id) => currentSuggestionIds.has(id))
      );
      setError("");
    } catch (err: any) {
      setError(err?.message || "The Work Inbox could not be loaded. Please try again.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent).detail?.source === "work-inbox") return;
      void load(true);
    };
    window.addEventListener("lc:tasks-updated", refresh);
    return () => window.removeEventListener("lc:tasks-updated", refresh);
  }, [load]);

  const filtered = useMemo(
    () => (data?.items || []).filter((item) => belongsTo(item, filter)),
    [data?.items, filter]
  );
  const shown = filtered.slice(0, visible);
  const firstActionableId = shown.find((item) => !item.done && !item.waiting)?.id;

  const chooseFilter = (next: Filter) => {
    setFilter(next);
    setVisible(10);
    setEditingId("");
    setNotice("");
  };

  const updateTask = async (
    item: WorkInboxItem,
    change: { text?: string; status?: "done" | "dismissed" }
  ) => {
    if (savingId) return;
    const previous = data;
    setSavingId(item.id);
    setError("");
    setNotice("");
    if (change.status === "dismissed") {
      setData((current) =>
        current
          ? { ...current, items: current.items.filter((row) => row.id !== item.id) }
          : current
      );
    } else if (change.status === "done") {
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                row.id === item.id
                  ? { ...row, done: true, priority: 0, priorityLabel: "done" }
                  : row
              ),
            }
          : current
      );
    } else if (change.text) {
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                row.id === item.id ? { ...row, title: change.text! } : row
              ),
            }
          : current
      );
    }
    try {
      const result = await crmFetch<{ task: { status: string; text: string } }>(
        `/api/crm/tasks/${item.sourceId}`,
        { method: "PATCH", body: JSON.stringify(change) }
      );
      if (change.status && result.task?.status !== change.status)
        throw new Error("The database did not confirm that status.");
      if (change.text && result.task?.text !== capitaliseSentenceStarts(change.text))
        throw new Error("The database did not confirm that edit.");
      setEditingId("");
      setNotice(change.text ? "Edit saved." : change.status === "done" ? "Marked done." : "Removed from the inbox.");
      await load(true);
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "work-inbox" },
        })
      );
    } catch (err: any) {
      setData(previous);
      setError(err?.message || "That change did not save. Please try again.");
    } finally {
      setSavingId("");
    }
  };

  const dismissDraft = async (item: WorkInboxItem) => {
    if (savingId) return;
    const previous = data;
    setSavingId(item.id);
    setError("");
    setData((current) =>
      current
        ? { ...current, items: current.items.filter((row) => row.id !== item.id) }
        : current
    );
    try {
      const result = await crmFetch<{ followUp: { status: string } }>(
        `/api/crm/follow-ups/${item.sourceId}`,
        { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }
      );
      if (result.followUp?.status !== "dismissed")
        throw new Error("The database did not confirm that removal.");
      setNotice("Draft removed.");
      await load(true);
    } catch (err: any) {
      setData(previous);
      setError(err?.message || "That draft did not stay removed. Please try again.");
    } finally {
      setSavingId("");
    }
  };

  const toggleCleanup = (id: string) => {
    setSelectedCleanup((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const applyCleanup = async () => {
    if (!selectedCleanup.length || cleanupBusy) return;
    setCleanupBusy(true);
    setError("");
    setNotice("");
    setCleanupFailures([]);
    try {
      const result = await crmFetch<{
        completed: { id: string; taskIds: string[] }[];
        notCompleted: { id: string; reason: string }[];
        dismissedTaskIds: string[];
      }>("/api/crm/inbox/cleanup", {
        method: "POST",
        body: JSON.stringify({ suggestionIds: selectedCleanup }),
      });
      const completed = result.completed?.length || 0;
      const failed = result.notCompleted || [];
      setCleanupFailures(failed);
      setUndoTaskIds(result.dismissedTaskIds || []);
      setSelectedCleanup([]);
      setNotice(
        `${completed} cleanup ${completed === 1 ? "change" : "changes"} saved.${
          failed.length
            ? ` ${failed.length} ${failed.length === 1 ? "item was" : "items were"} not completed.`
            : ""
        }`
      );
      await load(true);
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "work-inbox" },
        })
      );
    } catch (err: any) {
      setError(err?.message || "The approved cleanup was not completed.");
    } finally {
      setCleanupBusy(false);
    }
  };

  const undoCleanup = async () => {
    if (!undoTaskIds.length || cleanupBusy) return;
    setCleanupBusy(true);
    setError("");
    try {
      const result = await crmFetch<{
        restored: string[];
        notCompleted: { id: string; reason: string }[];
      }>("/api/crm/inbox/cleanup", {
        method: "POST",
        body: JSON.stringify({ mode: "undo", taskIds: undoTaskIds }),
      });
      setCleanupFailures(result.notCompleted || []);
      setNotice(
        `${result.restored?.length || 0} archived ${
          result.restored?.length === 1 ? "task was" : "tasks were"
        } restored.${result.notCompleted?.length ? " Some changes could not be undone." : ""}`
      );
      setUndoTaskIds([]);
      await load(true);
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "work-inbox" },
        })
      );
    } catch (err: any) {
      setError(err?.message || "The cleanup could not be undone.");
    } finally {
      setCleanupBusy(false);
    }
  };

  const askBrainToEdit = (suggestion: WorkCleanupSuggestion) => {
    const task = suggestion.taskTitles[0] || suggestion.title;
    const request =
      suggestion.kind === "needs_date"
        ? `Help me decide and set a realistic deadline for this to-do: ${task}`
        : `Review this waiting to-do and help me either chase it, complete it or dismiss it: ${task}`;
    window.dispatchEvent(
      new CustomEvent("lc:open-brain", { detail: { prompt: request } })
    );
  };

  const countFor = (key: Filter) => {
    if (!data) return 0;
    if (key === "now") return data.counts.now;
    if (key === "revenue") return data.counts.revenue;
    if (key === "approvals") return data.counts.approvals;
    if (key === "waiting") return data.counts.waiting;
    if (key === "cleanup") return data.cleanup?.counts.total || 0;
    if (key === "all") return data.counts.all;
    return data.counts.done;
  };

  return (
    <>
      <NavMenu />
      <main className="relative z-10 mx-auto max-w-[920px] px-4 py-8 sm:px-5 sm:py-10">
        <header className="mb-4 border-b border-edge pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[1.65rem] leading-none text-bone">
                Work <span className="italic text-amber">Inbox</span>
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-5 text-muted">
                One prioritized queue for tasks, approvals, replies, drafts and call preparation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="min-h-11 rounded-full border border-edge px-4 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-sky/45 hover:text-sky disabled:opacity-40"
            >
              {loading ? "Refreshing…" : "⟳ Refresh"}
            </button>
          </div>
          <p className="mt-3 rounded-lg border border-sage/30 bg-sage/[0.06] px-3 py-2 text-xs leading-5 text-sage">
            No extra AI cost. Email approvals still open the exact draft before anything can be sent.
          </p>
        </header>

        {data ? (
          <section className="mb-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-amber/35 bg-amber/[0.06] p-3">
              <strong className="block font-display text-2xl text-amber">{data.counts.now}</strong>
              <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">To handle</span>
            </div>
            <div className="rounded-xl border border-rust/35 bg-rust/[0.06] p-3">
              <strong className="block font-display text-2xl text-rust">{data.counts.urgent}</strong>
              <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">Urgent</span>
            </div>
            <div className="rounded-xl border border-moss/35 bg-moss/[0.06] p-3">
              <strong className="block font-display text-2xl text-moss">{data.counts.revenue}</strong>
              <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">Revenue</span>
            </div>
          </section>
        ) : null}

        <nav aria-label="Work inbox filters" className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => chooseFilter(item.key)}
              aria-pressed={filter === item.key}
              className={`min-h-10 shrink-0 rounded-full border px-3 font-mono text-[0.56rem] uppercase tracking-wider transition ${
                filter === item.key
                  ? "border-amber/60 bg-amber/15 text-amber"
                  : "border-edge text-muted hover:text-bone"
              }`}
            >
              {item.label} · {countFor(item.key)}
            </button>
          ))}
        </nav>

        {notice ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sage/35 bg-sage/10 px-3 py-2 text-sm text-sage">
            <p>✓ {notice}</p>
            {undoTaskIds.length ? (
              <button
                type="button"
                onClick={() => void undoCleanup()}
                disabled={cleanupBusy}
                className="min-h-9 rounded-full border border-sage/45 px-3 font-mono text-[0.52rem] uppercase tracking-wider disabled:opacity-40"
              >
                Undo cleanup
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mb-3 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p>
        ) : null}
        {cleanupFailures.length ? (
          <section role="alert" className="mb-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-3">
            <p className="font-mono text-[0.58rem] uppercase tracking-wider text-rust">
              Not completed · {cleanupFailures.length}
            </p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-rust/90">
              {cleanupFailures.map((failure) => (
                <li key={`${failure.id}:${failure.reason}`}>• {failure.reason}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {filter === "cleanup" && data ? (
          <section>
            <div className="mb-3 rounded-xl border border-amber/35 bg-amber/[0.06] p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-xl">
                  <h2 className="font-display text-lg text-bone">Smart cleanup review</h2>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Safe suggestions use fixed rules, not AI. Nothing is archived until you select it and approve the batch. Important items stay flagged for a Brain edit.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.cleanup.counts.actionable ? (
                    <button
                      type="button"
                      onClick={() => {
                        const actionable = data.cleanup.suggestions
                          .filter((suggestion) => suggestion.safeToApply)
                          .map((suggestion) => suggestion.id);
                        const allSelected = actionable.every((id) =>
                          selectedCleanup.includes(id)
                        );
                        setSelectedCleanup(allSelected ? [] : actionable);
                      }}
                      disabled={cleanupBusy}
                      className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.52rem] uppercase tracking-wider text-muted hover:text-bone disabled:opacity-40"
                    >
                      {data.cleanup.suggestions
                        .filter((suggestion) => suggestion.safeToApply)
                        .every((suggestion) => selectedCleanup.includes(suggestion.id))
                        ? "Clear selection"
                        : "Select safe suggestions"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void applyCleanup()}
                    disabled={!selectedCleanup.length || cleanupBusy}
                    className="min-h-10 rounded-lg border border-sage/50 bg-sage/10 px-4 font-mono text-[0.52rem] uppercase tracking-wider text-sage disabled:opacity-35"
                  >
                    {cleanupBusy
                      ? "Saving…"
                      : `Approve selected · ${selectedCleanup.length}`}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-edge/60 pt-3 text-center">
                <div>
                  <strong className="block font-display text-xl text-sky">{data.cleanup.counts.duplicates}</strong>
                  <span className="font-mono text-[0.46rem] uppercase text-muted">Duplicates</span>
                </div>
                <div>
                  <strong className="block font-display text-xl text-rust">{data.cleanup.counts.stale}</strong>
                  <span className="font-mono text-[0.46rem] uppercase text-muted">Stale</span>
                </div>
                <div>
                  <strong className="block font-display text-xl text-amber">{data.cleanup.counts.flagged}</strong>
                  <span className="font-mono text-[0.46rem] uppercase text-muted">Need a decision</span>
                </div>
              </div>
            </div>

            {data.cleanup.suggestions.length ? (
              <div>
                <ul className="space-y-2">
                {data.cleanup.suggestions.slice(0, visible).map((suggestion) => {
                  const copy = cleanupCopy[suggestion.kind];
                  const selected = selectedCleanup.includes(suggestion.id);
                  return (
                    <li
                      key={suggestion.id}
                      className={`rounded-xl border p-3 sm:p-4 ${
                        selected
                          ? "border-sage/55 bg-sage/[0.06]"
                          : "border-edge bg-panel/45"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {suggestion.safeToApply ? (
                          <label className="flex min-h-11 shrink-0 cursor-pointer items-center">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleCleanup(suggestion.id)}
                              aria-label={`Select cleanup for ${suggestion.title}`}
                              className="h-5 w-5 accent-sage"
                            />
                          </label>
                        ) : (
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono ${copy.style}`}>
                            {copy.icon}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.48rem] uppercase tracking-wider ${copy.style}`}>
                              {copy.label}
                            </span>
                            {suggestion.safeToApply ? (
                              <span className="font-mono text-[0.48rem] uppercase tracking-wider text-sage">
                                Reversible archive
                              </span>
                            ) : (
                              <span className="font-mono text-[0.48rem] uppercase tracking-wider text-amber">
                                Not changed
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm leading-5 text-bone">
                            {capitaliseSentenceStarts(suggestion.title)}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {capitaliseSentenceStarts(suggestion.reason)}
                          </p>
                          {suggestion.kind === "duplicate" ? (
                            <ul className="mt-2 space-y-1 border-l border-edge pl-3 text-xs text-muted">
                              {suggestion.taskTitles.slice(0, 4).map((title) => (
                                <li key={title}>Archive: {capitaliseSentenceStarts(title)}</li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            {suggestion.companyId ? (
                              <Link href={`/crm/${suggestion.companyId}`} className="font-mono text-[0.5rem] uppercase tracking-wider text-sky hover:text-bone">
                                {suggestion.company || "Open client"} ↗
                              </Link>
                            ) : (
                              <span className="font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                                Unlinked task
                              </span>
                            )}
                            {!suggestion.safeToApply ? (
                              <button
                                type="button"
                                onClick={() => askBrainToEdit(suggestion)}
                                className="min-h-10 rounded-lg border border-amber/45 bg-amber/10 px-3 font-mono text-[0.5rem] uppercase tracking-wider text-amber"
                              >
                                Ask Brain to edit
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
                </ul>
                {data.cleanup.suggestions.length > visible ? (
                  <button
                    type="button"
                    onClick={() => setVisible((count) => count + 10)}
                    className="mt-3 min-h-11 w-full rounded-xl border border-edge font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/45 hover:text-amber"
                  >
                    Show 10 more · {data.cleanup.suggestions.length - visible} remaining
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-moss/35 bg-moss/[0.06] px-4 py-12 text-center">
                <p className="font-display text-xl text-bone">The inbox is tidy.</p>
                <p className="mt-1 text-sm text-muted">No duplicates, stale loose work or undecided old items were found.</p>
              </div>
            )}
          </section>
        ) : loading && !data ? (
          <MatrixRain size="panel" messages={["loading work inbox", "ranking what needs attention"]} />
        ) : shown.length ? (
          <ol className="space-y-2">
            {shown.map((item) => {
              const copy = kindCopy[item.kind];
              const first = item.id === firstActionableId;
              const when = formatWhen(item.dueAt || item.createdAt);
              const whenLabel = item.done
                ? "Completed"
                : item.kind === "reply"
                  ? "Received"
                  : item.waiting
                    ? "Since"
                    : item.dueAt
                      ? "Due"
                      : "Added";
              return (
                <li
                  key={item.id}
                  className={`rounded-xl border bg-panel/45 p-3 sm:p-4 ${
                    first ? "border-amber/60 shadow-[0_0_0_1px_rgba(217,161,75,0.08)]" : "border-edge"
                  } ${item.done ? "opacity-65" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-sm ${priorityStyle[item.priorityLabel]}`}>
                      {copy.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {first ? (
                          <span className="rounded-full border border-amber/50 bg-amber/10 px-2 py-0.5 font-mono text-[0.48rem] uppercase tracking-wider text-amber">Do this next</span>
                        ) : null}
                        <span className="font-mono text-[0.5rem] uppercase tracking-wider text-muted">{copy.label}</span>
                        {item.revenue && !item.done ? (
                          <span className="rounded-full border border-moss/35 px-2 py-0.5 font-mono text-[0.46rem] uppercase tracking-wider text-moss">Revenue</span>
                        ) : null}
                      </div>

                      {editingId === item.id ? (
                        <div className="mt-2">
                          <input
                            autoFocus
                            value={editingText}
                            onChange={(event) => setEditingText(event.target.value)}
                            className="w-full rounded-lg border border-amber/50 bg-ink px-3 py-2 text-sm text-bone outline-none"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const next = editingText.trim();
                                if (next && next !== item.title) void updateTask(item, { text: next });
                                else setEditingId("");
                              }}
                              disabled={savingId === item.id || !editingText.trim()}
                              className="min-h-10 rounded-lg border border-sage/45 bg-sage/10 px-3 font-mono text-[0.54rem] uppercase text-sage disabled:opacity-40"
                            >
                              Save edit
                            </button>
                            <button type="button" onClick={() => setEditingId("")} className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.54rem] uppercase text-muted">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <Link href={item.href} className={`mt-1 block text-[0.92rem] leading-snug hover:text-amber ${item.done ? "text-muted line-through" : "text-bone"}`}>
                          {capitaliseSentenceStarts(item.title)}
                        </Link>
                      )}

                      {item.detail ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{capitaliseSentenceStarts(item.detail)}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                        {item.companyId ? (
                          <Link href={`/crm/${item.companyId}`} className="text-sky hover:text-bone">{item.company || "Open client"} ↗</Link>
                        ) : item.company ? (
                          <span>{item.company}</span>
                        ) : null}
                        {when ? <span>{whenLabel} {when}</span> : null}
                      </div>
                    </div>
                  </div>

                  {!item.done && editingId !== item.id ? (
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-edge/70 pt-3">
                      {item.kind === "task" && item.editable ? (
                        <button
                          type="button"
                          onClick={() => { setEditingId(item.id); setEditingText(item.title); }}
                          disabled={!!savingId}
                          className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.52rem] uppercase tracking-wider text-muted hover:text-amber disabled:opacity-40"
                        >
                          Edit
                        </button>
                      ) : null}
                      {item.kind === "task" ? (
                        <button
                          type="button"
                          onClick={() => void updateTask(item, { status: "done" })}
                          disabled={!!savingId}
                          className="min-h-10 rounded-lg border border-sage/45 bg-sage/10 px-3 font-mono text-[0.52rem] uppercase tracking-wider text-sage disabled:opacity-40"
                        >
                          ✓ Done
                        </button>
                      ) : null}
                      {item.dismissible ? (
                        <button
                          type="button"
                          onClick={() => item.kind === "follow_up" ? void dismissDraft(item) : void updateTask(item, { status: "dismissed" })}
                          disabled={!!savingId}
                          aria-label={`Dismiss ${item.title}`}
                          className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.52rem] uppercase tracking-wider text-muted hover:border-rust/45 hover:text-rust disabled:opacity-40"
                        >
                          Dismiss
                        </button>
                      ) : null}
                      <Link
                        href={item.href}
                        className="inline-flex min-h-10 items-center rounded-lg border border-amber/50 bg-amber/10 px-4 font-mono text-[0.52rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
                      >
                        {item.approval ? "Review safely" : item.kind === "prep" ? "Prepare" : "Open"} ↗
                      </Link>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <section className="rounded-xl border border-moss/35 bg-moss/[0.06] px-4 py-12 text-center">
            <p className="font-display text-xl text-bone">Nothing is waiting here.</p>
            <p className="mt-1 text-sm text-muted">Choose another filter or return to today’s priorities.</p>
          </section>
        )}

        {filtered.length > visible ? (
          <button
            type="button"
            onClick={() => setVisible((count) => count + 10)}
            className="mt-3 min-h-11 w-full rounded-xl border border-edge font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/45 hover:text-amber"
          >
            Show 10 more · {filtered.length - visible} remaining
          </button>
        ) : null}
      </main>
    </>
  );
}
