"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import { capitaliseSentenceStarts } from "@/lib/text";
import type { WorkInboxItem, WorkInboxResponse } from "@/lib/work-inbox";

type Filter = "now" | "revenue" | "approvals" | "waiting" | "all" | "done";

const filters: { key: Filter; label: string }[] = [
  { key: "now", label: "Do now" },
  { key: "revenue", label: "Revenue" },
  { key: "approvals", label: "Approvals" },
  { key: "waiting", label: "Waiting" },
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

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await crmFetch<WorkInboxResponse>("/api/crm/inbox");
      setData(next);
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

  const countFor = (key: Filter) => {
    if (!data) return 0;
    if (key === "now") return data.counts.now;
    if (key === "revenue") return data.counts.revenue;
    if (key === "approvals") return data.counts.approvals;
    if (key === "waiting") return data.counts.waiting;
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
          <p className="mb-3 rounded-lg border border-sage/35 bg-sage/10 px-3 py-2 text-sm text-sage">✓ {notice}</p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-3 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p>
        ) : null}

        {loading && !data ? (
          <div className="space-y-2">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-28 animate-pulse rounded-xl border border-edge bg-panel/35" />
            ))}
          </div>
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
